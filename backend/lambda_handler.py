"""
AWS Lambda entry point for the HeatShield FastAPI backend.

Mangum wraps the ASGI app so that API Gateway / Lambda Function URL
events are translated into standard ASGI requests and responses.

Usage in Lambda console / SAM / CDK:
    Handler: lambda_handler.handler
"""
from mangum import Mangum
from main import app

# Mangum translates AWS Lambda event + context → ASGI → FastAPI
handler = Mangum(app, lifespan="off")
