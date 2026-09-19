# 🧠 AnythingLLM Rebranded as VertexAI

**AnythingLLM**! This is a full-stack application designed to transform your documents and content into a powerful, chat-ready context using off-the-shelf tools and commercially viable AI technologies. 

This codebase contains everything built so far, including the GTD (Getting Things Done) document flow. 
---

## 🏗️ Project Layout

Here is a quick overview of how the repository is structured:

- **`frontend/`** — The user interface, built with Vite and React.
- **`server/`** — The core API server. This handles the chat flow and integrates with our MongoDB-backed **GTD** database setup.
- **`collector/`** — Our document parsing and ingestion service.
- **`docker/`** — Containerization and deployment files.
- **`embed/` & `browser-extension/`** — Submodules for integrations.

---

## 🚀 Quick Start (Local Development)

To get the entire stack running locally, follow these steps:

1. **Install Dependencies & Prepare Environment**
   Run the setup command from the repository root. This will install all dependencies across the sub-projects and copy the necessary example environment files.
   ```bash
   yarn setup
   ```

2. **Configure the GTD Database**
   Open `server/.env.development` and ensure the `MONGODB_URI` is correctly filled in. This connection string is required to enable the MongoDB-backed GTD support. 
   *(Note: If you are using Docker, configure `docker/.env` instead. Make sure to double-check your MongoDB host depending on your environment).*

3. **Start the Development Services**
   You can run all three core services (Server, Frontend, and Collector) together concurrently with a single command:
   ```bash
   yarn dev:all
   ```

   *Alternatively, if you need to run them individually in separate terminal tabs:*
   - `yarn dev:server` (Starts the backend API)
   - `yarn dev:frontend` (Starts the Vite UI)
   - `yarn dev:collector` (Starts the document collector)

---

## 🗄️ Understanding the GTD Integration

Server comes with built-in **MongoDB-backed GTD support**. 
When the `MONGODB_URI` environment variable is set, the server will initialize a MongoDB connection in the background upon startup. Once connected, it seamlessly injects the GTD context extractor directly into the chat flow. 

If you'd like to trace how this works under the hood, the GTD startup path is initialized in [`server/index.js`](server/index.js).

---

## 📝 Additional Notes

- The ultimate source of truth for all available scripts and dependencies is our [`package.json`](package.json).
- If you're testing the production server locally without the dev-servers, you can start it using `yarn prod:server`.

