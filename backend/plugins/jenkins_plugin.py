import aiohttp
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any
import logging
import base64
from server import DataSourcePlugin, DeploymentEvent, IncidentEvent, ChangeEvent

logger = logging.getLogger(__name__)

class JenkinsPlugin(DataSourcePlugin):
    """Jenkins plugin for fetching build and deployment data"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.url = config.get('url', '').rstrip('/')
        self.username = config.get('username')
        self.token = config.get('token')
        
        # Create basic auth header
        auth_string = f"{self.username}:{self.token}"
        auth_bytes = auth_string.encode('ascii')
        self.auth_header = base64.b64encode(auth_bytes).decode('ascii')
    
    async def test_connection(self) -> bool:
        """Test Jenkins connection"""
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Basic {self.auth_header}'
                }
                
                url = f'{self.url}/api/json'
                async with session.get(url, headers=headers) as response:
                    return response.status == 200
        except Exception as e:
            logger.error(f"Jenkins connection test failed: {e}")
            return False
    
    async def fetch_deployments(self, start_date: datetime, end_date: datetime) -> List[DeploymentEvent]:
        """Fetch Jenkins builds as deployment events"""
        deployments = []
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Basic {self.auth_header}'
                }
                
                # Get all jobs
                jobs = await self._get_jobs(session, headers)
                
                for job_name in jobs:
                    # Get builds for each job
                    builds_url = f'{self.url}/job/{job_name}/api/json?tree=builds[number,timestamp,result,url,actions[lastBuiltRevision[SHA1]],changeSet[items[commitId,author[fullName]]]]'
                    
                    async with session.get(builds_url, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            
                            for build in data.get('builds', []):
                                # Convert Jenkins timestamp (milliseconds) to datetime
                                build_time = datetime.fromtimestamp(
                                    build['timestamp'] / 1000,
                                    tz=timezone.utc
                                )
                                
                                if start_date <= build_time <= end_date:
                                    # Extract commit SHA from build actions
                                    commit_sha = ''
                                    for action in build.get('actions', []):
                                        if 'lastBuiltRevision' in action:
                                            commit_sha = action['lastBuiltRevision']['SHA1']
                                            break
                                    
                                    # Map Jenkins result to our status
                                    status = 'success' if build.get('result') == 'SUCCESS' else 'failed'
                                    
                                    deployment_event = DeploymentEvent(
                                        timestamp=build_time,
                                        repository=job_name,
                                        environment='production',  # Jenkins doesn't specify environment
                                        commit_sha=commit_sha,
                                        status=status,
                                        data_source=self.name,
                                        metadata={
                                            'build_number': build['number'],
                                            'build_url': build['url'],
                                            'result': build.get('result'),
                                            'job_name': job_name
                                        }
                                    )
                                    deployments.append(deployment_event)
        
        except Exception as e:
            logger.error(f"Error fetching Jenkins deployments: {e}")
        
        return deployments
    
    async def fetch_incidents(self, start_date: datetime, end_date: datetime) -> List[IncidentEvent]:
        """Jenkins doesn't have native incident tracking, infer from failed builds"""
        incidents = []
        
        try:
            # We can infer incidents from failed builds that break the build
            deployments = await self.fetch_deployments(start_date, end_date)
            
            for deployment in deployments:
                if deployment.status == 'failed':
                    incident_event = IncidentEvent(
                        incident_id=f"jenkins-{deployment.metadata.get('build_number', 'unknown')}",
                        started_at=deployment.timestamp,
                        resolved_at=None,  # Jenkins doesn't track resolution
                        severity='medium',
                        affected_services=[deployment.repository],
                        data_source=self.name,
                        metadata={
                            'build_number': deployment.metadata.get('build_number'),
                            'job_name': deployment.repository,
                            'inferred_from': 'failed_build'
                        }
                    )
                    incidents.append(incident_event)
        
        except Exception as e:
            logger.error(f"Error inferring Jenkins incidents: {e}")
        
        return incidents
    
    async def fetch_changes(self, start_date: datetime, end_date: datetime) -> List[ChangeEvent]:
        """Fetch Jenkins build changes as change events"""
        changes = []
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Basic {self.auth_header}'
                }
                
                jobs = await self._get_jobs(session, headers)
                
                for job_name in jobs:
                    builds_url = f'{self.url}/job/{job_name}/api/json?tree=builds[number,timestamp,changeSet[items[commitId,author[fullName],msg,date]]]'
                    
                    async with session.get(builds_url, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            
                            for build in data.get('builds', []):
                                build_time = datetime.fromtimestamp(
                                    build['timestamp'] / 1000,
                                    tz=timezone.utc
                                )
                                
                                if start_date <= build_time <= end_date:
                                    change_set = build.get('changeSet', {})
                                    for item in change_set.get('items', []):
                                        # Use commit time if available, otherwise use build time
                                        commit_time = build_time
                                        if 'date' in item:
                                            try:
                                                commit_time = datetime.fromtimestamp(
                                                    item['date'] / 1000,
                                                    tz=timezone.utc
                                                )
                                            except:
                                                pass
                                        
                                        change_event = ChangeEvent(
                                            change_id=item.get('commitId', f"build-{build['number']}"),
                                            created_at=commit_time,
                                            merged_at=build_time,  # Assume merge time is build time
                                            repository=job_name,
                                            author=item.get('author', {}).get('fullName', 'Unknown'),
                                            data_source=self.name,
                                            metadata={
                                                'build_number': build['number'],
                                                'commit_message': item.get('msg', ''),
                                                'job_name': job_name
                                            }
                                        )
                                        changes.append(change_event)
        
        except Exception as e:
            logger.error(f"Error fetching Jenkins changes: {e}")
        
        return changes
    
    async def _get_jobs(self, session: aiohttp.ClientSession, headers: Dict[str, str]) -> List[str]:
        """Get list of Jenkins jobs"""
        jobs = []
        try:
            url = f'{self.url}/api/json?tree=jobs[name]'
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    jobs = [job['name'] for job in data.get('jobs', [])[:10]]  # Limit to 10 jobs
        except Exception as e:
            logger.error(f"Error fetching Jenkins jobs: {e}")
        
        return jobs
