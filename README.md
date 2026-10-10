# HeatShield

HeatShield is a heat-exposure-aware route recommendation web application.
It generates candidate walking routes and scores them using environmental factors, helping users find the best balance between travel time and estimated heat exposure.

## Project Structure
- `/frontend`: React + Vite + TypeScript application with Tailwind CSS and Leaflet.
- `/backend`: Python FastAPI application providing REST endpoints.

## Tech Stack
- **Frontend**: React, Vite, TypeScript, Tailwind CSS, React Leaflet
- **Backend**: Python, FastAPI
- **Routing**: OpenStreetMap (OSRM public routing API)

## Setup

### Backend
1. `cd backend`
2. `python -m venv venv`
3. `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux)
4. `pip install -r requirements.txt`
5. `uvicorn main:app --reload`

### Frontend
1. `cd frontend`
2. `npm install`
3. `npm run dev`
