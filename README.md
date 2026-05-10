# Personal Markov blanket

Your Wikipedia glossary. Add concepts via URLs.

## Setup

**1. Clone & install**
```bash
git clone https://github.com/mtripnaux/blanket
cd blanket
npm install
```

**2. Configure**

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```
ADMIN_PASSWORD=your_password
```

**3. Run**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Admin is at `/admin`.

> **Note:** concepts are stored in `data/glossary.json`.
