import aiohttp
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
import logging
from server import DataSourcePlugin, DeploymentEvent, IncidentEvent, ChangeEvent

logger = logging.getLogger(__name__)

class DynatracePlugin(DataSourcePlugin):
    """Dynatrace plugin for fetching incident and performance data"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.url = config.get('url', '').rstrip('/')
        self.token = config.get('token')
        self.api_url = f"{self.url}/api/v2"
    
    async def test_connection(self) -> bool:
        """Test Dynatrace API connection"""
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Api-Token {self.token}',
                    'Content-Type': 'application/json'
                }
                
                url = f'{self.api_url}/version'
                async with session.get(url, headers=headers) as response:
                    return response.status == 200
        except Exception as e:
            logger.error(f"Dynatrace connection test failed: {e}")
            return False
    
    async def fetch_deployments(self, start_date: datetime, end_date: datetime) -> List[DeploymentEvent]:
        """Dynatrace doesn't track deployments directly, return empty list"""
        # Dynatrace focuses on monitoring and incidents
        # Deployments would typically be tracked through custom events or tags
        return []
    
    async def fetch_incidents(self, start_date: datetime, end_date: datetime) -> List[IncidentEvent]:
        """Fetch Dynatrace problems as incident events"""
        incidents = []
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Api-Token {self.token}',
                    'Content-Type': 'application/json'
                }
                
                # Convert to timestamps in milliseconds
                start_timestamp = int(start_date.timestamp() * 1000)
                end_timestamp = int(end_date.timestamp() * 1000)
                
                url = f'{self.api_url}/problems'
                params = {
                    'from': start_timestamp,
                    'to': end_timestamp,
                    'fields': '+evidenceDetails,+recentComments,+impactedEntities'
                }
                
                async with session.get(url, headers=headers, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        for problem in data.get('problems', []):
                            started_at = datetime.fromtimestamp(
                                problem['startTime'] / 1000,
                                tz=timezone.utc
                            )
                            
                            resolved_at = None
                            if problem.get('endTime') and problem['endTime'] != -1:
                                resolved_at = datetime.fromtimestamp(
                                    problem['endTime'] / 1000,
                                    tz=timezone.utc
                                )
                            
                            # Map Dynatrace impact level to severity
                            severity_map = {
                                'APPLICATION': 'high',
                                'SERVICE': 'high', 
                                'INFRASTRUCTURE': 'medium',
                                'ENVIRONMENT': 'low'
                            }
                            severity = severity_map.get(problem.get('impactLevel', 'ENVIRONMENT'), 'medium')
                            
                            # Extract affected services from impacted entities
                            affected_services = []
                            for entity in problem.get('impactedEntities', []):
                                if entity.get('displayName'):
                                    affected_services.append(entity['displayName'])
                            
                            incident_event = IncidentEvent(
                                incident_id=problem['problemId'],
                                started_at=started_at,
                                resolved_at=resolved_at,
                                severity=severity,
                                affected_services=affected_services[:5],  # Limit to 5 services
                                data_source=self.name,
                                metadata={
                                    'problem_url': problem.get('problemUrl', ''),
                                    'display_name': problem.get('displayName', ''),
                                    'impact_level': problem.get('impactLevel', ''),
                                    'status': problem.get('status', ''),
                                    'root_cause': problem.get('rootCauseEntity', {}).get('displayName', ''),
                                    'management_zones': [mz.get('name', '') for mz in problem.get('managementZones', [])]
                                }
                            )
                            incidents.append(incident_event)
        
        except Exception as e:
            logger.error(f"Error fetching Dynatrace incidents: {e}")
        
        return incidents
    
    async def fetch_changes(self, start_date: datetime, end_date: datetime) -> List[ChangeEvent]:
        """Fetch Dynatrace custom deployment events as changes"""
        changes = []
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Api-Token {self.token}',
                    'Content-Type': 'application/json'
                }
                
                # Convert to timestamps in milliseconds
                start_timestamp = int(start_date.timestamp() * 1000)
                end_timestamp = int(end_date.timestamp() * 1000)
                
                # Fetch custom deployment events
                url = f'{self.api_url}/events'
                params = {
                    'from': start_timestamp,
                    'to': end_timestamp,
                    'eventTypes': 'CUSTOM_DEPLOYMENT',
                    'fields': '+properties'
                }
                
                async with session.get(url, headers=headers, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        for event in data.get('events', []):
                            event_time = datetime.fromtimestamp(
                                event['startTime'] / 1000,
                                tz=timezone.utc
                            )
                            
                            # Extract metadata from properties
                            properties = event.get('properties', {})
                            
                            change_event = ChangeEvent(
                                change_id=event['eventId'],
                                created_at=event_time,
                                merged_at=event_time,  # For Dynatrace, creation and merge are the same
                                repository=properties.get('source', 'unknown'),
                                author=properties.get('deployedBy', 'Unknown'),
                                data_source=self.name,
                                metadata={
                                    'event_type': event.get('eventType', ''),
                                    'deployment_name': properties.get('deploymentName', ''),
                                    'deployment_version': properties.get('deploymentVersion', ''),
                                    'deployment_project': properties.get('deploymentProject', ''),
                                    'ci_back_link': properties.get('ciBackLink', ''),
                                    'affected_entities': [entity.get('displayName', '') for entity in event.get('affectedEntities', [])]
                                }
                            )
                            changes.append(change_event)
        
        except Exception as e:
            logger.error(f"Error fetching Dynatrace changes: {e}")
        
        return changes
    
    async def _get_synthetic_monitors(self, session: aiohttp.ClientSession, headers: Dict[str, str]) -> List[Dict]:
        """Get synthetic monitors for additional incident detection"""
        monitors = []
        try:
            url = f'{self.api_url}/synthetic/monitors'
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    monitors = data.get('monitors', [])
        except Exception as e:
            logger.error(f"Error fetching synthetic monitors: {e}")
        
        return monitors
