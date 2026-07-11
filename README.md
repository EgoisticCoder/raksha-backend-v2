# RAKSHA Backend

Node.js + Express backend for the RAKSHA disaster response platform.

## Features

- REST API for auth, SOS intake, teams, admin workflows, SMS, and AI services
- Socket.IO for real-time incident and responder updates
- Neo4j-backed graph data model
- BullMQ scheduled agents for alerts, routing, escalation, and resource workflows
- Render deployment config via `render.yaml`

## Environment

Copy `.env.example` to `.env` and provide:

- `NEO4J_URI`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `SARVAM_API_KEY`
- `GROQ_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `EXPO_ACCESS_TOKEN`
- `RAKSHA_API_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `BACKEND_URL`
- `ROUTING_WEBHOOK_SECRET`
- `REDIS_URL`
- `JWT_SECRET`
- `SUPERVISOR_PHONE`

## Run Locally

```bash
npm install
npm start
```

## Deploy To Render

- Create a new Render web service from this folder
- Use the included `render.yaml`
- Set all required environment variables in Render
- Make sure `REDIS_URL` points to a reachable Redis instance
