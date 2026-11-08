const fs = require('fs');
const path = require('path');
const https = require('https');

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQM10NnmHnP1UPPF7EU1EOBF5vI9pTXPyj1MbcIoKUZyt9k8ovtbuURMMekuAuYFMYaHGw9UNdss8em/pub?output=csv';

// Caché en memoria para no saturar la planilla de Google
let sheetCache = {
  rows: null,
  timestamp: 0
};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
        return fetchCSV(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP status ${res.statusCode}`));
      }
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
  }
  return rows;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async (req, res) => {
  const templatePath = path.join(process.cwd(), '_disco.html');
  let html = '';

  try {
    html = fs.readFileSync(templatePath, 'utf8');
  } catch (err) {
    return res.status(500).send('Error loading template');
  }

  // Obtener el ID del disco
  let albumId = req.query.id;
  if (!albumId && req.url) {
    const match = req.url.match(/\/disco\/(\d+)/);
    if (match) albumId = match[1];
  }

  const albumIndex = parseInt(albumId, 10);
  if (isNaN(albumIndex) || albumIndex < 0) {
    // Si no hay ID válido, servir la plantilla original
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }

  try {
    const now = Date.now();
    if (!sheetCache.rows || now - sheetCache.timestamp > CACHE_TTL) {
      const csvText = await fetchCSV(SHEET_CSV_URL);
      sheetCache.rows = parseCSV(csvText);
      sheetCache.timestamp = now;
    }

    const rows = sheetCache.rows;
    if (albumIndex < rows.length) {
      const cols = rows[albumIndex];
      const rawArtistAlbum = (cols[0] || '').replace(/^Hoja \d+\s*/i, '').trim();
      const year = (cols[1] || '').trim();
      const link = (cols[2] || '').trim();
      const manualCover = (cols[3] || '').trim();
      const location = (cols[5] || '').trim();
      const crew = (cols[6] || '').trim();
      const resena = (cols[7] || '').trim();

      let artist = rawArtistAlbum;
      let album = rawArtistAlbum;
      if (rawArtistAlbum.includes(' - ')) {
        const parts = rawArtistAlbum.split(' - ');
        artist = parts[0].trim();
        album = parts.slice(1).join(' - ').replace(/\(\d{4}\??\)/g, '').trim();
      }

      // Buscar imagen de portada
      let coverUrl = manualCover;
      if (!coverUrl && link) {
        const ytMatch = link.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/))([\w-]{11})/);
        if (ytMatch) {
          coverUrl = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
        }
      }

      // Descripción para redes
      const descParts = [];
      if (year) descParts.push(`Año: ${year}`);
      if (location) descParts.push(`Ubicación: ${location}`);
      if (crew) descParts.push(`Crew/Sello: ${crew}`);
      let description = descParts.join(' · ');
      if (resena) {
        description += (description ? ' — ' : '') + resena.slice(0, 150) + (resena.length > 150 ? '...' : '');
      }
      if (!description) {
        description = 'Catálogo discográfico histórico y contemporáneo del hip hop argentino (1989-presente).';
      }

      const pageTitle = `${escapeHtml(album)} - ${escapeHtml(artist)} | Archivo del Rap Argentino`;
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const canonicalUrl = host ? `${proto}://${host}/disco/${albumIndex}` : '';

      const ogMetaTags = `
  <title>${pageTitle}</title>
  <meta property="og:type" content="music.album">
  <meta property="og:site_name" content="Archivo del Rap Argentino">
  <meta property="og:title" content="${escapeHtml(album)} - ${escapeHtml(artist)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ''}
  ${coverUrl ? `<meta property="og:image" content="${escapeHtml(coverUrl)}">` : ''}
  ${coverUrl ? `<meta property="og:image:secure_url" content="${escapeHtml(coverUrl)}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(album)} - ${escapeHtml(artist)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${coverUrl ? `<meta name="twitter:image" content="${escapeHtml(coverUrl)}">` : ''}
      `.trim();

      // Inyectar en el HTML reemplazando el <title> existente
      html = html.replace(/<title>.*?<\/title>/i, ogMetaTags);
    }
  } catch (err) {
    console.error('Error fetching/injecting disk metadata:', err);
    // En caso de error, sirve la plantilla por defecto sin romper la página
  }

  // Encabezados de caché para que Vercel Edge CDN sirva respuestas ultrarrápidas
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
};

