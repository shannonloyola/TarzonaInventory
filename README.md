# Wine & Liquor Inventory Management

This is a code bundle for Wine & Liquor Inventory Management. The original project is available at https://www.figma.com/design/1sb05nVlAfxLit7ch4vvW2/Wine---Liquor-Inventory-Management.

## Prerequisites

- Node.js 18+ (recommended: latest LTS)
- npm 9+

## Setup and Run (Localhost)

1. Open terminal in project root.
2. Install dependencies:

```bash
npm install
```

3. Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

For Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

4. Edit `.env` and set:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

5. Start development server:

```bash
npm run dev
```

6. Open the local URL shown by Vite (usually):

```text
http://localhost:5173
```
