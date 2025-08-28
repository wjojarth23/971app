# 971 Hub - Manufacturing Management System

A comprehensive manufacturing management system built with SvelteKit, featuring OnShape CAD integration and AI-powered BOM analysis.

## Features

- **OnShape Integration**: Connect CAD documents and analyze assemblies
- **AI-Powered BOM Classification**: Uses ChatGPT-4-mini to intelligently classify parts as COTS or manufactured
- **Manufacturing Process Assignment**: Automatically assigns appropriate manufacturing processes (mill, laser-cut, 3D-print, etc.)
- **Stock Management**: Track and assign stock materials to parts
- **Build Management**: Create and manage manufacturing builds
- **User Authentication**: Secure user management with Supabase

## New: ChatGPT Integration

The system now includes ChatGPT-4-mini integration for intelligent part classification:

- **Intelligent Classification**: AI determines if parts are COTS or manufactured
- **Process Assignment**: Recommends manufacturing processes based on materials and geometry
- **Confidence Levels**: Shows AI confidence in decisions
- **Fallback Logic**: Automatic fallback to rule-based classification if AI is unavailable

See [CHATGPT_INTEGRATION.md](./CHATGPT_INTEGRATION.md) for detailed setup instructions.

## Setup

### Prerequisites

- Node.js 18+
- Supabase account
- OnShape developer account
- OpenAI API key (for ChatGPT integration)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```env
   # OpenAI API Key for ChatGPT integration
   OPENAI_API_KEY=sk-your-openai-key-here
   
   # OnShape API Configuration
   PUBLIC_ONSHAPE_ACCESS_KEY=your_onshape_access_key
   PUBLIC_ONSHAPE_SECRET_KEY=your_onshape_secret_key
   PUBLIC_ONSHAPE_BASE_URL=https://cad.onshape.com
   
   # Supabase Configuration
   PUBLIC_SUPABASE_URL=your_supabase_url
   PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. Set up the database (run in Supabase SQL Editor, in this order):
   - `migration_add_build_system.sql`
   - `migration_add_other_category.sql`
   - `migration_add_drawing_support.sql`
   See BUILD_SYSTEM_SETUP.md for details. Do not run `migration_fix_builds.sql` (deprecated).

## Developing

Start the development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Testing ChatGPT Integration

Test the ChatGPT API connection:

```bash
node test-chatgpt.js
```

## Building

To create a production version:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

- `/src/lib/` - Shared libraries and utilities
  - `onshape.js` - OnShape API integration
  - `chatgpt.js` - ChatGPT service for BOM classification
  - `supabase.js` - Database connection
- `/src/routes/` - SvelteKit routes
  - `/api/chatgpt/` - Server-side ChatGPT API endpoint
  - `/cad/` - CAD management pages
- `/static/` - Static assets

## Documentation

- [ChatGPT Integration Guide](./CHATGPT_INTEGRATION.md) - Detailed setup and usage
- [Supabase Setup](./SUPABASE_SETUP.md) - Database configuration

## Deployment

The app can be deployed to any SvelteKit-compatible platform. Make sure to configure environment variables in your deployment environment.

> You may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
