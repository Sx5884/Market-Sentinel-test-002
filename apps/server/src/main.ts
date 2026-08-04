import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// --- CRASH PREVENTION HANDLERS ---
process.on('uncaughtException', (err) => {
  console.error('⚠️ [Uncaught Exception Prevented]:', err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Unhandled Rejection Prevented]:', reason);
});

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// --- SAFE STRING CLEANER HELPER ---
function cleanHtmlText(input: any): string {
  if (!input) return '';
  let str = '';
  if (Array.isArray(input)) {
    str = String(input || input[0] || '');
  } else {
    str = String(input);
  }
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// --- SAFE FETCH WRAPPER ---
async function safeFetchText(url: string, sourceName: string, headers: Record<string, string> = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.log(`⚠️ [Fetch Error Debug] Source: "${sourceName}" (${url}) -> HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.text();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log(`⚠️ [Fetch Timeout Debug] Source: "${sourceName}" (${url}) -> Request timed out after 10 seconds.`);
    } else {
      console.log(`⚠️ [Fetch Network Error Debug] Source: "${sourceName}" (${url}) -> ${err.message || err}`);
    }
    return null;
  }
}

// --- TELEGRAM NOTIFICATION DISPATCHER ---
async function sendTelegramNotification(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  if (!settings?.telegramEnabled) return;
  const chatId = settings?.telegramChatId || process.env.TELEGRAM_CHAT_ID;

  if (!token || token.includes('your_telegram_bot_token') || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
    });
    const data = await res.json();
    if (data.ok) console.log(`✅ [Telegram Success] Alert sent to Chat ID: ${chatId}`);
    else console.error(`❌ [Telegram Error]: ${data.description}`);
  } catch (err) {
    console.error('❌ [Telegram Error]:', err);
  }
}

// --- EMAIL NOTIFICATION DISPATCHER (RESEND API) ---
async function sendEmailNotification(subject: string, htmlContent: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  if (!settings?.emailEnabled) return;

  const recipient = settings?.recipientEmail;

  if (!apiKey || apiKey.includes('re_123456789') || !recipient) {
    console.log('⚠️ [Email Warning] RESEND_API_KEY or recipient email missing in .env / Settings.');
    return;
  }

  console.log(`📧 [EMAIL DISPATCH] Sending email alert to: ${recipient}...`);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Market Sentinel <onboarding@resend.dev>',
        to: [recipient],
        subject: subject,
        html: `<div style="font-family: system-ui, sans-serif; padding: 20px; background: #0f172a; color: #f8fafc; border-radius: 8px;">
                <h2 style="color: #38bdf8; margin-top: 0;">Market Sentinel Alert</h2>
                <div style="font-size: 1rem; line-height: 1.6;">${htmlContent}</div>
                <hr style="border-color: #334155; margin: 20px 0;">
                <small style="color: #94a3b8;">Automated Market Intelligence Notification</small>
               </div>`,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`✅ [Email Success] Alert delivered via Resend to: ${recipient}`);
    } else {
      console.error(`❌ [Email Error from Resend API]:`, data);
    }
  } catch (err) {
    console.error('❌ [Email Error]:', err);
  }
}

// --- CONTENT EXTRACTION ENGINE ---
async function processAndIngestSource(source: any, triggerMode: 'AUTO' | 'MANUAL' = 'AUTO') {
  console.log(`🔍 [${triggerMode} FETCH] Scraping content for: ${source.name} (${source.url})`);
  
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const isDedupEnabled = settings?.deduplicationEnabled ?? true;

  const rawText = await safeFetchText(source.url, source.name);
  if (!rawText) return 0;

  const items: Array<{ title: string; link: string; snippet: string }> = [];

  const titleMatch = rawText.match(/<title[^>]*>(.*?)<\/title>/i);
  let title = cleanHtmlText(titleMatch) || source.name;

  const metaDescMatch = rawText.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i) ||
                        rawText.match(/<meta[^>]*property=["']og:description["'][^>]*content=["'](.*?)["']/i);
  
  let snippet = cleanHtmlText(metaDescMatch);

  if (!snippet) {
    const pMatch = rawText.match(/<p[^>]*>(.*?)<\/p>/gi);
    if (pMatch && pMatch.length > 0) {
      const cleanP = cleanHtmlText(pMatch[0]);
      if (cleanP.length > 15) snippet = cleanP.substring(0, 250) + '...';
    }
  }

  if (!snippet) snippet = 'New headline detected on source page.';

  const itemLink = source.url;

  items.push({
    title: title.length > 100 ? title.substring(0, 100) + '...' : title,
    link: itemLink,
    snippet: snippet,
  });

  let newEventCount = 0;

  for (const item of items) {
    let hashInput = `${item.title}-${item.link}`;
    if (!isDedupEnabled) {
      hashInput += `-${Date.now()}-${Math.random()}`;
    }

    const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    let isDuplicate = false;
    if (isDedupEnabled) {
      const existing = await prisma.event.findFirst({
        where: { sourceId: source.id, contentHash: contentHash },
      });
      if (existing) isDuplicate = true;
    }

    if (!isDuplicate) {
      try {
        await prisma.event.create({
          data: {
            sourceId: source.id,
            categoryId: source.categoryId,
            title: item.title,
            description: item.snippet,
            originalContent: item.snippet,
            directLink: item.link,
            contentHash: contentHash,
            publishedAt: new Date(),
          },
        });

        newEventCount++;

        const telegramHtml = `
📰 <b>${item.title}</b>
<i>Source: ${source.name} (${triggerMode} CHECK)</i>

📝 <b>Preview / Starting Lines:</b>
${item.snippet}

🔗 <a href="${item.link}">Read Specific Article / Event ↗</a>
🌐 <a href="${source.url}">Main Source Portal</a>
        `;

        const emailHtml = `
          <p><strong>${item.title}</strong></p>
          <p><em>Source: ${source.name} (${triggerMode} CHECK)</em></p>
          <p><strong>Preview:</strong> ${item.snippet}</p>
          <p><a href="${item.link}" style="color: #38bdf8; font-weight: bold;">🔗 Read Specific Article / Event ↗</a></p>
        `;

        await sendTelegramNotification(telegramHtml);
        await sendEmailNotification(`Market Sentinel Alert: ${item.title}`, emailHtml);
      } catch (dbErr: any) {
        if (dbErr?.code === 'P2002') {
          console.log(`ℹ️ [DEDUP FILTER] Skipped duplicate item for ${source.name}`);
        } else {
          console.error(`❌ [Database Error]:`, dbErr.message || dbErr);
        }
      }
    } else {
      console.log(`ℹ️ [DEDUP FILTER] Skipped duplicate item for ${source.name}`);
    }
  }

  if (newEventCount === 0 && (settings as any)?.notifyWhenEmpty) {
    const emptyMsg = `Status Check Complete for source "${source.name}" (${triggerMode} CHECK). Result: 0 new events.`;
    await sendTelegramNotification(`🔔 <b>Market Sentinel Status Alert (${triggerMode})</b>\nSource: <b>${source.name}</b>\nResult: 0 new events detected.`);
    await sendEmailNotification(`Market Sentinel Status (${triggerMode}): ${source.name}`, emptyMsg);
  }

  console.log(`📊 [INGESTION STATS] ${source.name} | Mode: ${triggerMode} | New Events Ingested: ${newEventCount}`);
  return newEventCount;
}

// --- AUTOMATIC BACKGROUND SCHEDULER ENGINE ---
setInterval(async () => {
  try {
    const activeSources = await prisma.source.findMany({
      where: { status: 'active' },
    });

    const now = new Date();

    for (const source of activeSources) {
      const lastCheck = source.lastSuccessAt ? new Date(source.lastSuccessAt).getTime() : 0;
      const intervalMs = (source.checkIntervalSec || 300) * 1000;

      if (now.getTime() - lastCheck >= intervalMs) {
        console.log(`⏰ [AUTO SCHEDULER] Scheduled check: ${source.name}`);
        await processAndIngestSource(source, 'AUTO');

        await prisma.source.update({
          where: { id: source.id },
          data: { lastSuccessAt: now, consecutiveFailures: 0 },
        });
      }
    }
  } catch (err) {
    console.error('[Auto-Scheduler Error]:', err);
  }
}, 3000);

// --- REST API ENDPOINTS ---

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name required' });

    const newCategory = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    console.log(`➕ [CATEGORY CREATED] Name: ${name}`);
    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create category' });
  }
});

app.get('/api/events', async (req, res) => {
  try {
    const { status, search, categoryId, sourceId, sort } = req.query;
    let where: any = {};

    if (status === 'unread') {
      where.isRead = false;
      where.isArchived = false;
    } else if (status === 'starred') {
      where.isStarred = true;
      where.isArchived = false;
    } else if (status === 'archived') {
      where.isArchived = true;
    } else {
      where.isArchived = false;
    }

    if (categoryId && typeof categoryId === 'string' && categoryId !== 'all') {
      where.categoryId = categoryId;
    }

    if (sourceId && typeof sourceId === 'string' && sourceId !== 'all') {
      where.sourceId = sourceId;
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    let orderBy: any = { publishedAt: 'desc' };
    if (sort === 'oldest') orderBy = { publishedAt: 'asc' };
    if (sort === 'title_asc') orderBy = { title: 'asc' };

    const events = await prisma.event.findMany({
      where,
      include: { source: true, category: true },
      orderBy,
      take: 50,
    });

    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.patch('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { isRead, isStarred, isArchived } = req.body;

    const updated = await prisma.event.update({
      where: { id },
      data: {
        ...(isRead !== undefined && { isRead }),
        ...(isStarred !== undefined && { isStarred }),
        ...(isArchived !== undefined && { isArchived }),
      },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update event' });
  }
});

app.get('/api/sources', async (req, res) => {
  try {
    const sources = await prisma.source.findMany({
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(sources);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

app.post('/api/sources', async (req, res) => {
  try {
    const { name, url, type, categoryId, checkIntervalSec } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'Title and URL are required' });
    }

    let targetCategory = categoryId;
    if (!targetCategory) {
      const def = await prisma.category.findFirst();
      targetCategory = def ? def.id : (await prisma.category.create({ data: { name: 'General' } })).id;
    }

    const newSource = await prisma.source.create({
      data: {
        name,
        url,
        type: type || 'auto',
        categoryId: targetCategory,
        checkIntervalSec: parseInt(checkIntervalSec) || 300,
        status: 'active',
      },
    });

    console.log(`➕ [SOURCE ADDED] Name: "${name}" | URL: ${url} | Type: ${type} | Interval: ${checkIntervalSec}s`);
    res.status(201).json(newSource);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create source' });
  }
});

app.put('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, type, categoryId, checkIntervalSec, status } = req.body;

    const updated = await prisma.source.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(url && { url }),
        ...(type && { type: type || 'auto' }),
        ...(categoryId && { categoryId }),
        ...(checkIntervalSec && { checkIntervalSec: parseInt(checkIntervalSec) }),
        ...(status && { status }),
      },
    });

    console.log(`✏️ [SOURCE EDITED] ID: ${id} | Name: "${updated.name}" | Interval: ${updated.checkIntervalSec}s`);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update source' });
  }
});

app.patch('/api/sources/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updated = await prisma.source.update({
      where: { id },
      data: { status },
    });

    console.log(`🔄 [SOURCE STATUS CHANGED] ${updated.name} -> ${updated.status.toUpperCase()}`);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update source status' });
  }
});

app.delete('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.event.deleteMany({ where: { sourceId: id } });
    await prisma.fetchLog.deleteMany({ where: { sourceId: id } });
    await prisma.source.delete({ where: { id } });
    console.log(`🗑️ [SOURCE DELETED] ID: ${id}`);
    res.json({ message: 'Source deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete source' });
  }
});

app.post('/api/sources/:id/trigger', async (req, res) => {
  try {
    const { id } = req.params;
    const source = await prisma.source.findUnique({ where: { id } });

    if (!source) return res.status(404).json({ error: 'Source not found' });

    console.log(`⚡ [MANUAL FETCH TRIGGERED] User initiated check for: ${source.name}`);
    const newEventsCount = await processAndIngestSource(source, 'MANUAL');

    await prisma.source.update({
      where: { id },
      data: { lastSuccessAt: new Date(), consecutiveFailures: 0, status: 'active' },
    });

    res.json({ message: 'Source check triggered', newEventsCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger source' });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { id: 1 } });
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { telegramEnabled, emailEnabled, notifyWhenEmpty, deduplicationEnabled, showToastAlerts, telegramChatId, recipientEmail } = req.body;

    const updated = await prisma.settings.upsert({
      where: { id: 1 },
      update: {
        telegramEnabled: Boolean(telegramEnabled),
        emailEnabled: Boolean(emailEnabled),
        notifyWhenEmpty: Boolean(notifyWhenEmpty),
        deduplicationEnabled: Boolean(deduplicationEnabled),
        showToastAlerts: Boolean(showToastAlerts),
        telegramChatId,
        recipientEmail,
      },
      create: {
        id: 1,
        telegramEnabled: Boolean(telegramEnabled),
        emailEnabled: Boolean(emailEnabled),
        notifyWhenEmpty: Boolean(notifyWhenEmpty),
        deduplicationEnabled: Boolean(deduplicationEnabled),
        showToastAlerts: Boolean(showToastAlerts),
        telegramChatId,
        recipientEmail,
      },
    });

    console.log(`⚙️ [SETTINGS SAVED] Telegram: ${telegramEnabled} | Email: ${emailEnabled} | Recipient: "${recipientEmail || 'N/A'}" | Dedup: ${deduplicationEnabled}`);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// --- SERVE STATIC FRONTEND INDEX.HTML ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`Market Sentinel Dashboard: http://localhost:${PORT}`);
  console.log(`================================================`);
});