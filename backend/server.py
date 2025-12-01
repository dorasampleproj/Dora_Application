from fastapi import FastAPI, APIRouter, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import uuid
from datetime import datetime, timezone
from abc import ABC, abstractmethod
import asyncio
from enum import Enum

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="DevOps DORA Dashboard", description="Pluggable DORA metrics dashboard")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Plugin Framework Models
class MetricType(str, Enum):
    DEPLOYMENT_FREQUENCY = "deployment_frequency"
    LEAD_TIME = "lead_time"
    CHANGE_FAILURE_RATE = "change_failure_rate"
    MTTR = "mean_time_to_recovery"

class DataSourceType(str, Enum):
    GITHUB = "github"
    JENKINS = "jenkins"
    DYNATRACE = "dynatrace"
    JIRA = "jira"

class DataSourceConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: DataSourceType
    config: Dict[str, Any]  # API keys, URLs, etc.
    enabled: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DORAMetric(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    metric_type: MetricType
    value: float
    unit: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    data_source: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class DeploymentEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime
    repository: str
    environment: str
    commit_sha: str
    status: str  # success, failed
    data_source: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class IncidentEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    incident_id: str
    started_at: datetime
    resolved_at: Optional[datetime] = None
    severity: str
    affected_services: List[str]
    data_source: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ChangeEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    change_id: str
    created_at: datetime
    merged_at: Optional[datetime] = None
    repository: str
    author: str
    data_source: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

# Abstract Base Plugin Interface
class DataSourcePlugin(ABC):
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.name = config.get('name', 'Unknown')
    
    @abstractmethod
    async def test_connection(self) -> bool:
        """Test if the data source is accessible"""
        pass
    
    @abstractmethod
    async def fetch_deployments(self, start_date: datetime, end_date: datetime) -> List[DeploymentEvent]:
        """Fetch deployment events for DORA metrics calculation"""
        pass
    
    @abstractmethod
    async def fetch_incidents(self, start_date: datetime, end_date: datetime) -> List[IncidentEvent]:
        """Fetch incident events for failure rate and MTTR calculation"""
        pass
    
    @abstractmethod
    async def fetch_changes(self, start_date: datetime, end_date: datetime) -> List[ChangeEvent]:
        """Fetch change events for lead time calculation"""
        pass

# Plugin Registry
class PluginRegistry:
    def __init__(self):
        self.plugins: Dict[str, type] = {}
        self.instances: Dict[str, DataSourcePlugin] = {}
    
    def register_plugin(self, plugin_type: str, plugin_class: type):
        self.plugins[plugin_type] = plugin_class
    
    async def create_instance(self, config: DataSourceConfig) -> DataSourcePlugin:
        if config.type not in self.plugins:
            raise ValueError(f"Plugin type {config.type} not registered")
        
        plugin_class = self.plugins[config.type]
        instance = plugin_class(config.config)
        self.instances[config.id] = instance
        return instance
    
    def get_instance(self, config_id: str) -> Optional[DataSourcePlugin]:
        return self.instances.get(config_id)

# Import and register plugins
from plugins.github_plugin import GitHubPlugin
from plugins.jenkins_plugin import JenkinsPlugin
from plugins.dynatrace_plugin import DynatracePlugin
from plugins.jira_plugin import JiraPlugin

# Global plugin registry
plugin_registry = PluginRegistry()

# Register all plugins
plugin_registry.register_plugin('github', GitHubPlugin)
plugin_registry.register_plugin('jenkins', JenkinsPlugin)
plugin_registry.register_plugin('dynatrace', DynatracePlugin)
plugin_registry.register_plugin('jira', JiraPlugin)

# DORA Metrics Calculator
class DORAMetricsCalculator:
    def __init__(self, plugin_registry: PluginRegistry):
        self.plugin_registry = plugin_registry
    
    async def calculate_deployment_frequency(self, start_date: datetime, end_date: datetime) -> float:
        """Calculate deployments per day"""
        total_deployments = 0
        
        for instance in self.plugin_registry.instances.values():
            try:
                deployments = await instance.fetch_deployments(start_date, end_date)
                successful_deployments = [d for d in deployments if d.status == 'success']
                total_deployments += len(successful_deployments)
            except Exception as e:
                logging.error(f"Error fetching deployments from {instance.name}: {e}")
        
        days = (end_date - start_date).days or 1
        return total_deployments / days
    
    async def calculate_lead_time(self, start_date: datetime, end_date: datetime) -> float:
        """Calculate average lead time in hours"""
        total_lead_time = 0
        total_changes = 0
        
        for instance in self.plugin_registry.instances.values():
            try:
                changes = await instance.fetch_changes(start_date, end_date)
                for change in changes:
                    if change.merged_at:
                        lead_time = (change.merged_at - change.created_at).total_seconds() / 3600
                        total_lead_time += lead_time
                        total_changes += 1
            except Exception as e:
                logging.error(f"Error fetching changes from {instance.name}: {e}")
        
        return total_lead_time / total_changes if total_changes > 0 else 0
    
    async def calculate_change_failure_rate(self, start_date: datetime, end_date: datetime) -> float:
        """Calculate percentage of deployments that cause failures"""
        total_deployments = 0
        failed_deployments = 0
        
        for instance in self.plugin_registry.instances.values():
            try:
                deployments = await instance.fetch_deployments(start_date, end_date)
                total_deployments += len(deployments)
                failed_deployments += len([d for d in deployments if d.status == 'failed'])
            except Exception as e:
                logging.error(f"Error fetching deployments from {instance.name}: {e}")
        
        return (failed_deployments / total_deployments * 100) if total_deployments > 0 else 0
    
    async def calculate_mttr(self, start_date: datetime, end_date: datetime) -> float:
        """Calculate mean time to recovery in hours"""
        total_recovery_time = 0
        resolved_incidents = 0
        
        for instance in self.plugin_registry.instances.values():
            try:
                incidents = await instance.fetch_incidents(start_date, end_date)
                for incident in incidents:
                    if incident.resolved_at:
                        recovery_time = (incident.resolved_at - incident.started_at).total_seconds() / 3600
                        total_recovery_time += recovery_time
                        resolved_incidents += 1
            except Exception as e:
                logging.error(f"Error fetching incidents from {instance.name}: {e}")
        
        return total_recovery_time / resolved_incidents if resolved_incidents > 0 else 0

# Initialize calculator
metrics_calculator = DORAMetricsCalculator(plugin_registry)

# Helper function for date parsing
def parse_date_param(date_str: str) -> datetime:
    """Parse date parameter handling URL encoding issues"""
    # Handle URL encoding issues where + becomes space
    clean_date = date_str.replace('Z', '+00:00').replace(' 00:00', '+00:00')
    return datetime.fromisoformat(clean_date)

# API Routes
@api_router.get("/")
async def root():
    return {"message": "DevOps DORA Dashboard API", "version": "1.0.0"}

@api_router.post("/data-sources", response_model=DataSourceConfig)
async def create_data_source(config: DataSourceConfig):
    """Create a new data source configuration"""
    try:
        # Test the connection first
        instance = await plugin_registry.create_instance(config)
        connection_test = await instance.test_connection()
        
        if not connection_test:
            raise HTTPException(status_code=400, detail="Failed to connect to data source")
        
        # Store in database
        config_dict = config.dict()
        await db.data_sources.insert_one(config_dict)
        
        return config
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.get("/data-sources", response_model=List[DataSourceConfig])
async def get_data_sources():
    """Get all configured data sources"""
    sources = await db.data_sources.find().to_list(1000)
    return [DataSourceConfig(**source) for source in sources]

@api_router.get("/data-sources/{source_id}/test")
async def test_data_source(source_id: str):
    """Test connection to a data source"""
    instance = plugin_registry.get_instance(source_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Data source not found")
    
    try:
        result = await instance.test_connection()
        return {"success": result, "message": "Connection successful" if result else "Connection failed"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@api_router.get("/metrics/deployment-frequency")
async def get_deployment_frequency(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Get deployment frequency metric"""
    # Default to last 30 days if no dates provided
    if not start_date or not end_date:
        end = datetime.now(timezone.utc)
        start = end.replace(day=end.day-30) if end.day > 30 else end.replace(month=end.month-1)
    else:
        start = parse_date_param(start_date)
        end = parse_date_param(end_date)
    
    frequency = await metrics_calculator.calculate_deployment_frequency(start, end)
    
    metric = DORAMetric(
        metric_type=MetricType.DEPLOYMENT_FREQUENCY,
        value=frequency,
        unit="deployments/day",
        data_source="aggregated"
    )
    
    # Store metric
    await db.metrics.insert_one(metric.dict())
    
    return metric

@api_router.get("/metrics/lead-time")
async def get_lead_time(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Get lead time metric"""
    if not start_date or not end_date:
        end = datetime.now(timezone.utc)
        start = end.replace(day=end.day-30) if end.day > 30 else end.replace(month=end.month-1)
    else:
        start = parse_date_param(start_date)
        end = parse_date_param(end_date)
    
    lead_time = await metrics_calculator.calculate_lead_time(start, end)
    
    metric = DORAMetric(
        metric_type=MetricType.LEAD_TIME,
        value=lead_time,
        unit="hours",
        data_source="aggregated"
    )
    
    await db.metrics.insert_one(metric.dict())
    
    return metric

@api_router.get("/metrics/change-failure-rate")
async def get_change_failure_rate(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Get change failure rate metric"""
    if not start_date or not end_date:
        end = datetime.now(timezone.utc)
        start = end.replace(day=end.day-30) if end.day > 30 else end.replace(month=end.month-1)
    else:
        start = parse_date_param(start_date)
        end = parse_date_param(end_date)
    
    failure_rate = await metrics_calculator.calculate_change_failure_rate(start, end)
    
    metric = DORAMetric(
        metric_type=MetricType.CHANGE_FAILURE_RATE,
        value=failure_rate,
        unit="percentage",
        data_source="aggregated"
    )
    
    await db.metrics.insert_one(metric.dict())
    
    return metric

@api_router.get("/metrics/mttr")
async def get_mttr(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Get mean time to recovery metric"""
    if not start_date or not end_date:
        end = datetime.now(timezone.utc)
        start = end.replace(day=end.day-30) if end.day > 30 else end.replace(month=end.month-1)
    else:
        start = parse_date_param(start_date)
        end = parse_date_param(end_date)
    
    mttr = await metrics_calculator.calculate_mttr(start, end)
    
    metric = DORAMetric(
        metric_type=MetricType.MTTR,
        value=mttr,
        unit="hours",
        data_source="aggregated"
    )
    
    await db.metrics.insert_one(metric.dict())
    
    return metric

@api_router.get("/metrics/dashboard")
async def get_dashboard_metrics(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Get all DORA metrics for dashboard"""
    if not start_date or not end_date:
        end = datetime.now(timezone.utc)
        start = end.replace(day=end.day-30) if end.day > 30 else end.replace(month=end.month-1)
    else:
        start = parse_date_param(start_date)
        end = parse_date_param(end_date)
    
    # Calculate all metrics concurrently
    deployment_freq_task = metrics_calculator.calculate_deployment_frequency(start, end)
    lead_time_task = metrics_calculator.calculate_lead_time(start, end)
    failure_rate_task = metrics_calculator.calculate_change_failure_rate(start, end)
    mttr_task = metrics_calculator.calculate_mttr(start, end)
    
    deployment_freq, lead_time, failure_rate, mttr = await asyncio.gather(
        deployment_freq_task, lead_time_task, failure_rate_task, mttr_task
    )
    
    return {
        "deployment_frequency": {
            "value": deployment_freq,
            "unit": "deployments/day",
            "timestamp": datetime.now(timezone.utc).isoformat()
        },
        "lead_time": {
            "value": lead_time,
            "unit": "hours", 
            "timestamp": datetime.now(timezone.utc).isoformat()
        },
        "change_failure_rate": {
            "value": failure_rate,
            "unit": "percentage",
            "timestamp": datetime.now(timezone.utc).isoformat()
        },
        "mean_time_to_recovery": {
            "value": mttr,
            "unit": "hours",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    }

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
