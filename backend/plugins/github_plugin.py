import aiohttp
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any
import logging
from server import DataSourcePlugin, DeploymentEvent, IncidentEvent, ChangeEvent

logger = logging.getLogger(__name__)

class GitHubPlugin(DataSourcePlugin):
    """GitHub plugin for fetching deployment and change data"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.token = config.get('token')
        self.org = config.get('org')
        self.repo = config.get('repo')  # Optional, if not provided, fetch from all repos
        self.base_url = 'https://api.github.com'
        
    async def test_connection(self) -> bool:
        """Test GitHub API connection"""
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'token {self.token}',
                    'Accept': 'application/vnd.github.v3+json'
                }
                
                url = f'{self.base_url}/user'
                async with session.get(url, headers=headers) as response:
                    return response.status == 200
        except Exception as e:
            logger.error(f"GitHub connection test failed: {e}")
            return False
    
    async def fetch_deployments(self, start_date: datetime, end_date: datetime) -> List[DeploymentEvent]:
        """Fetch GitHub deployments (using GitHub Deployments API)"""
        deployments = []
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'token {self.token}',
                    'Accept': 'application/vnd.github.v3+json'
                }
                
                repos = await self._get_repos(session, headers) if not self.repo else [self.repo]
                
                for repo in repos:
                    url = f'{self.base_url}/repos/{self.org}/{repo}/deployments'
                    async with session.get(url, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            
                            for deployment in data:
                                created_at = datetime.fromisoformat(
                                    deployment['created_at'].replace('Z', '+00:00')
                                )
                                
                                if start_date <= created_at <= end_date:
                                    # Get deployment status
                                    status_url = f"{url}/{deployment['id']}/statuses"
                                    async with session.get(status_url, headers=headers) as status_response:
                                        if status_response.status == 200:
                                            statuses = await status_response.json()
                                            latest_status = statuses[0] if statuses else {'state': 'pending'}
                                            
                                            deployment_event = DeploymentEvent(
                                                timestamp=created_at,
                                                repository=f"{self.org}/{repo}",
                                                environment=deployment.get('environment', 'production'),
                                                commit_sha=deployment.get('sha', ''),
                                                status='success' if latest_status['state'] == 'success' else 'failed',
                                                data_source=self.name,
                                                metadata={
                                                    'deployment_id': deployment['id'],
                                                    'ref': deployment.get('ref', ''),
                                                    'description': deployment.get('description', ''),
                                                    'creator': deployment.get('creator', {}).get('login', '')
                                                }
                                            )
                                            deployments.append(deployment_event)
                
        except Exception as e:
            logger.error(f"Error fetching GitHub deployments: {e}")
        
        return deployments
    
    async def fetch_incidents(self, start_date: datetime, end_date: datetime) -> List[IncidentEvent]:
        """GitHub doesn't have native incident tracking, return empty list"""
        # GitHub doesn't have built-in incident tracking
        # This would typically integrate with GitHub Issues labeled as incidents
        return []
    
    async def fetch_changes(self, start_date: datetime, end_date: datetime) -> List[ChangeEvent]:
        """Fetch GitHub pull requests as change events"""
        changes = []
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'token {self.token}',
                    'Accept': 'application/vnd.github.v3+json'
                }
                
                repos = await self._get_repos(session, headers) if not self.repo else [self.repo]
                
                for repo in repos:
                    url = f'{self.base_url}/repos/{self.org}/{repo}/pulls'
                    params = {
                        'state': 'closed',
                        'sort': 'updated',
                        'direction': 'desc',
                        'per_page': 100
                    }
                    
                    async with session.get(url, headers=headers, params=params) as response:
                        if response.status == 200:
                            data = await response.json()
                            
                            for pr in data:
                                if pr.get('merged_at'):
                                    created_at = datetime.fromisoformat(
                                        pr['created_at'].replace('Z', '+00:00')
                                    )
                                    merged_at = datetime.fromisoformat(
                                        pr['merged_at'].replace('Z', '+00:00')
                                    )
                                    
                                    if start_date <= created_at <= end_date:
                                        change_event = ChangeEvent(
                                            change_id=str(pr['id']),
                                            created_at=created_at,
                                            merged_at=merged_at,
                                            repository=f"{self.org}/{repo}",
                                            author=pr['user']['login'],
                                            data_source=self.name,
                                            metadata={
                                                'pr_number': pr['number'],
                                                'title': pr['title'],
                                                'additions': pr.get('additions', 0),
                                                'deletions': pr.get('deletions', 0),
                                                'changed_files': pr.get('changed_files', 0)
                                            }
                                        )
                                        changes.append(change_event)
        
        except Exception as e:
            logger.error(f"Error fetching GitHub changes: {e}")
        
        return changes
    
    async def _get_repos(self, session: aiohttp.ClientSession, headers: Dict[str, str]) -> List[str]:
        """Get list of repositories for the organization"""
        repos = []
        try:
            url = f'{self.base_url}/orgs/{self.org}/repos'
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    repos = [repo['name'] for repo in data[:10]]  # Limit to 10 repos for performance
        except Exception as e:
            logger.error(f"Error fetching repos: {e}")
        
        return repos
