import aiohttp
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any
import logging
import base64
from server import DataSourcePlugin, DeploymentEvent, IncidentEvent, ChangeEvent

logger = logging.getLogger(__name__)

class JiraPlugin(DataSourcePlugin):
    """Jira plugin for fetching issue and change tracking data"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.url = config.get('url', '').rstrip('/')
        self.email = config.get('email')
        self.token = config.get('token')
        
        # Create basic auth header for Jira Cloud
        auth_string = f"{self.email}:{self.token}"
        auth_bytes = auth_string.encode('ascii')
        self.auth_header = base64.b64encode(auth_bytes).decode('ascii')
        
        self.api_url = f"{self.url}/rest/api/3"
    
    async def test_connection(self) -> bool:
        """Test Jira API connection"""
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Basic {self.auth_header}',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
                
                url = f'{self.api_url}/myself'
                async with session.get(url, headers=headers) as response:
                    return response.status == 200
        except Exception as e:
            logger.error(f"Jira connection test failed: {e}")
            return False
    
    async def fetch_deployments(self, start_date: datetime, end_date: datetime) -> List[DeploymentEvent]:
        """Jira doesn't track deployments directly, but we can look for deployment-related issues"""
        deployments = []
        
        try:
            # Search for issues with deployment-related labels or types
            deployment_issues = await self._search_issues(
                'labels = "deployment" OR labels = "release" OR issuetype = "Deployment"',
                start_date,
                end_date
            )
            
            for issue in deployment_issues:
                created = datetime.fromisoformat(
                    issue['fields']['created'].replace('Z', '+00:00')
                )
                
                # Determine status based on issue resolution
                status = 'success' if issue['fields'].get('resolution') else 'failed'
                
                deployment_event = DeploymentEvent(
                    timestamp=created,
                    repository=issue['fields']['project']['key'],
                    environment='production',  # Default environment
                    commit_sha='',  # Jira doesn't track commits directly
                    status=status,
                    data_source=self.name,
                    metadata={
                        'issue_key': issue['key'],
                        'summary': issue['fields']['summary'],
                        'assignee': issue['fields'].get('assignee', {}).get('displayName', 'Unassigned'),
                        'reporter': issue['fields'].get('reporter', {}).get('displayName', 'Unknown'),
                        'priority': issue['fields'].get('priority', {}).get('name', 'Medium'),
                        'labels': issue['fields'].get('labels', []),
                        'issue_url': f"{self.url}/browse/{issue['key']}"
                    }
                )
                deployments.append(deployment_event)
        
        except Exception as e:
            logger.error(f"Error fetching Jira deployments: {e}")
        
        return deployments
    
    async def fetch_incidents(self, start_date: datetime, end_date: datetime) -> List[IncidentEvent]:
        """Fetch Jira incidents (bugs, outages, etc.)"""
        incidents = []
        
        try:
            # Search for incident-related issues
            incident_jql = 'issuetype in ("Bug", "Incident", "Outage", "Problem") OR priority in ("Critical", "Highest") OR labels = "incident"'
            incident_issues = await self._search_issues(incident_jql, start_date, end_date)
            
            for issue in incident_issues:
                created = datetime.fromisoformat(
                    issue['fields']['created'].replace('Z', '+00:00')
                )
                
                resolved_at = None
                if issue['fields'].get('resolutiondate'):
                    resolved_at = datetime.fromisoformat(
                        issue['fields']['resolutiondate'].replace('Z', '+00:00')
                    )
                
                # Map Jira priority to severity
                priority_to_severity = {
                    'Highest': 'critical',
                    'High': 'high', 
                    'Critical': 'critical',
                    'Medium': 'medium',
                    'Low': 'low',
                    'Lowest': 'low'
                }
                
                priority_name = issue['fields'].get('priority', {}).get('name', 'Medium')
                severity = priority_to_severity.get(priority_name, 'medium')
                
                # Extract affected services from components or labels
                affected_services = []
                for component in issue['fields'].get('components', []):
                    affected_services.append(component['name'])
                
                if not affected_services:
                    # Fallback to project name
                    affected_services = [issue['fields']['project']['name']]
                
                incident_event = IncidentEvent(
                    incident_id=issue['key'],
                    started_at=created,
                    resolved_at=resolved_at,
                    severity=severity,
                    affected_services=affected_services[:3],  # Limit to 3 services
                    data_source=self.name,
                    metadata={
                        'summary': issue['fields']['summary'],
                        'issue_type': issue['fields']['issuetype']['name'],
                        'status': issue['fields']['status']['name'],
                        'assignee': issue['fields'].get('assignee', {}).get('displayName', 'Unassigned'),
                        'reporter': issue['fields'].get('reporter', {}).get('displayName', 'Unknown'),
                        'priority': priority_name,
                        'labels': issue['fields'].get('labels', []),
                        'issue_url': f"{self.url}/browse/{issue['key']}",
                        'project': issue['fields']['project']['key']
                    }
                )
                incidents.append(incident_event)
        
        except Exception as e:
            logger.error(f"Error fetching Jira incidents: {e}")
        
        return incidents
    
    async def fetch_changes(self, start_date: datetime, end_date: datetime) -> List[ChangeEvent]:
        """Fetch Jira stories, tasks, and features as change events"""
        changes = []
        
        try:
            # Search for change-related issues (stories, tasks, features, improvements)
            change_jql = 'issuetype in ("Story", "Task", "Feature", "Improvement", "Enhancement") AND status = "Done"'
            change_issues = await self._search_issues(change_jql, start_date, end_date)
            
            for issue in change_issues:
                created = datetime.fromisoformat(
                    issue['fields']['created'].replace('Z', '+00:00')
                )
                
                merged_at = None
                if issue['fields'].get('resolutiondate'):
                    merged_at = datetime.fromisoformat(
                        issue['fields']['resolutiondate'].replace('Z', '+00:00')
                    )
                
                change_event = ChangeEvent(
                    change_id=issue['key'],
                    created_at=created,
                    merged_at=merged_at,
                    repository=issue['fields']['project']['key'],
                    author=issue['fields'].get('reporter', {}).get('displayName', 'Unknown'),
                    data_source=self.name,
                    metadata={
                        'summary': issue['fields']['summary'],
                        'issue_type': issue['fields']['issuetype']['name'],
                        'status': issue['fields']['status']['name'],
                        'assignee': issue['fields'].get('assignee', {}).get('displayName', 'Unassigned'),
                        'priority': issue['fields'].get('priority', {}).get('name', 'Medium'),
                        'story_points': issue['fields'].get('customfield_10016'),  # Common story points field
                        'epic_link': issue['fields'].get('customfield_10014'),  # Common epic link field
                        'labels': issue['fields'].get('labels', []),
                        'issue_url': f"{self.url}/browse/{issue['key']}",
                        'project': issue['fields']['project']['key']
                    }
                )
                changes.append(change_event)
        
        except Exception as e:
            logger.error(f"Error fetching Jira changes: {e}")
        
        return changes
    
    async def _search_issues(self, jql: str, start_date: datetime, end_date: datetime) -> List[Dict]:
        """Search Jira issues with JQL"""
        issues = []
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Basic {self.auth_header}',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
                
                # Add date filter to JQL
                start_str = start_date.strftime('%Y-%m-%d')
                end_str = end_date.strftime('%Y-%m-%d')
                date_filter = f' AND created >= "{start_str}" AND created <= "{end_str}"'
                full_jql = jql + date_filter
                
                url = f'{self.api_url}/search'
                payload = {
                    'jql': full_jql,
                    'maxResults': 100,  # Limit results for performance
                    'fields': [
                        'key', 'summary', 'created', 'resolutiondate', 'status',
                        'issuetype', 'priority', 'assignee', 'reporter', 'project',
                        'components', 'labels', 'resolution', 'customfield_10016',
                        'customfield_10014'
                    ]
                }
                
                async with session.post(url, headers=headers, json=payload) as response:
                    if response.status == 200:
                        data = await response.json()
                        issues = data.get('issues', [])
                    else:
                        logger.error(f"Jira search failed with status {response.status}")
        
        except Exception as e:
            logger.error(f"Error searching Jira issues: {e}")
        
        return issues
