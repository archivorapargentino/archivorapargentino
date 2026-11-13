const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQM10NnmHnP1UPPF7EU1EOBF5vI9pTXPyj1MbcIoKUZyt9k8ovtbuURMMekuAuYFMYaHGw9UNdss8em/pub?output=csv';

let rawData = [];
const grid = document.getElementById('albumGrid');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const statsDisplay = document.getElementById('statsDisplay');
const filterButtons = document.querySelectorAll('.filter-btn');
const headerMosaic = document.getElementById('headerMosaic');

let currentFilter = 'all';
let searchQuery = '';
let currentSort = 'desc';

const PRESERVED_GROUPS = [
  'Illya Kuryaki & The Valderramas',
  'Illya Kuriaky & Th Valderramas',
  'Illya Kuryaki and the Valderramas'
];

const coverCache = JSON.parse(localStorage.getItem('hh_covers') || '{}');

// Clear cover cache if ?clearCache present
if (new URLSearchParams(window.location.search).has('clearCache')) {
  localStorage.removeItem('hh_covers');
  console.log('Cover cache cleared via clearCache param');
}

function saveCoverCache(key, url) {
  coverCache[key] = url;
  try { localStorage.setItem('hh_covers', JSON.stringify(coverCache)); } catch (e) { }
}

function updateURLParams() {
  const params = new URLSearchParams();
  if (searchQuery) params.set('q', searchQuery);
  if (currentFilter && currentFilter !== 'all') params.set('filtro', currentFilter);
  if (currentSort && currentSort !== 'desc') params.set('orden', currentSort);

  const qs = params.toString();
  const newPath = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', newPath);
}

function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentVal += '"';
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
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

function processSheetRows(rows) {
  return rows.map((cols, index) => {
    let rawArtistAlbum = (cols[0] || '').replace(/^Hoja \d+\s*/i, '').trim();
    let year = (cols[1] || '').trim();
    let link = (cols[2] || '').trim();
    let manualCover = (cols[3] || '').trim();
    // Tracklist is column 4
    let tracklist = (cols[4] || '').trim();
    let location = (cols[5] || '').trim();
    let crew = (cols[6] || '').trim();
    let resena = (cols[7] || '').trim();

    let artist = rawArtistAlbum;
    let album = rawArtistAlbum;

    if (rawArtistAlbum.includes(' - ')) {
      const parts = rawArtistAlbum.split(' - ');
      artist = parts[0].trim();
      album = parts.slice(1).join(' - ').replace(/\(\d{4}\??\)/g, '').trim();
    }

    // Return with tracklist before id (index)
    return [artist, album, year, link, manualCover, tracklist, index, location, crew, resena];
  });
}

function formatArtistLinks(artistString) {
  const cleanName = artistString.trim();
  const isPreserved = PRESERVED_GROUPS.some(group => group.toLowerCase() === cleanName.toLowerCase());

  if (isPreserved) {
    return `<span class="artist-tag" data-artist="${cleanName}">${cleanName}</span>`;
  }

  const separators = /(?:,\s*|\s+&\s+|\s+y\s+|\s+x\s+)/i;
  const rawParts = cleanName.split(separators);

  return rawParts
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .map(name => `<span class="artist-tag" data-artist="${name}">${name}</span>`)
    .join(', ');
}

function getPlatform(url) {
  if (!url) return 'none';
  if (url.includes('spotify.com')) return 'spotify';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('bandcamp.com')) return 'bandcamp';
  if (url.includes('soundcloud.com')) return 'soundcloud';
  return 'other';
}

function extractYouTubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

async function fetchSpotifyCover(spotifyUrl) {
  if (coverCache[spotifyUrl]) return coverCache[spotifyUrl];
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.thumbnail_url) {
      saveCoverCache(spotifyUrl, data.thumbnail_url);
      return data.thumbnail_url;
    }
  } catch (e) { }
  return null;
}

async function fetchBandcampCover(bandcampUrl) {
  if (coverCache[bandcampUrl]) return coverCache[bandcampUrl];
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(bandcampUrl)}`);
    if (res.ok) {
      const json = await res.json();
      const imgUrl = json?.data?.image?.url || null;
      if (imgUrl) {
        saveCoverCache(bandcampUrl, imgUrl);
        return imgUrl;
      }
    }
  } catch (e) { }
  return null;
}

async function fetchSoundCloudCover(scUrl) {
  const cleanUrl = scUrl.split('?')[0];
  if (coverCache[cleanUrl]) return coverCache[cleanUrl];

  let imgUrl = null;
  try {
    const res = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(cleanUrl)}`);
    if (res.ok) {
      const data = await res.json();
      imgUrl = data.thumbnail_url || null;
    }
  } catch (e) { }

  if (!imgUrl) {
    try {
      const resMl = await fetch(`https://api.microlink.io?url=${encodeURIComponent(cleanUrl)}`);
      if (resMl.ok) {
        const jsonMl = await resMl.json();
        imgUrl = jsonMl?.data?.image?.url || null;
      }
    } catch (e) { }
  }

  if (imgUrl && imgUrl.includes('-large.jpg')) {
    imgUrl = imgUrl.replace('-large.jpg', '-t500x500.jpg');
  }

  if (imgUrl) saveCoverCache(cleanUrl, imgUrl);
  return imgUrl;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function updateHeaderMosaic() {
  if (!headerMosaic) return;

  // Build list of available covers from any platform, including manual covers and YouTube thumbnails.
  const availableCovers = rawData
    .filter(([artist, album, year, link, manualCover, tracklist, id]) => {
      // Manual cover always valid
      if (manualCover && manualCover !== '') return true;
      const platform = getPlatform(link);
      if (platform === 'youtube') return true; // YouTube thumbnail can be generated
      const cleanLink = link.split('?')[0];
      return coverCache[cleanLink] || coverCache[link];
    })
    .map(([artist, album, year, link, manualCover, tracklist, id]) => {
      let coverUrl = manualCover || '';
      const platform = getPlatform(link);
      if (!coverUrl) {
        if (platform === 'youtube') {
          const ytId = extractYouTubeId(link);
          if (ytId) coverUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
        } else {
          const cleanLink = link.split('?')[0];
          coverUrl = coverCache[cleanLink] || coverCache[link] || '';
        }
      }
      return { artist, album, id, cover: coverUrl };
    })
    .filter(item => !!item.cover);

  const uniqueCoversMap = new Map();
  availableCovers.forEach(item => {
    if (!uniqueCoversMap.has(item.cover)) uniqueCoversMap.set(item.cover, item);
  });

  const uniqueList = Array.from(uniqueCoversMap.values());
  if (uniqueList.length < 8) {
    headerMosaic.style.display = 'none';
    return;
  }

  const containerWidth = headerMosaic.clientWidth || 1200;
  let cols = Math.floor(containerWidth / 78);
  if (cols < 6) cols = 6;
  if (cols > 15) cols = 15;

  const totalNeeded = cols * 2;
  headerMosaic.style.setProperty('--mosaic-cols', cols);

  const randomSelection = shuffleArray(uniqueList).slice(0, totalNeeded);
  const finalCount = Math.floor(randomSelection.length / cols) * cols;
  const finalItems = randomSelection.slice(0, finalCount);

  if (finalItems.length === 0) {
    headerMosaic.style.display = 'none';
    return;
  }

  headerMosaic.style.display = 'grid';
  headerMosaic.innerHTML = '';

  finalItems.forEach(item => {
    const img = document.createElement('img');
    img.src = item.cover;
    img.className = 'mosaic-thumb';
    img.alt = `${item.album} - ${item.artist}`;
    img.title = `${item.artist} - ${item.album} (Clic para ver ficha)`;
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); };
    img.addEventListener('click', () => {
      window.location.href = `disco/${item.id}`;
    });
    headerMosaic.appendChild(img);
  });
}


let observer;
const requestQueue = [];
let isProcessing = false;

function initObserver() {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const container = entry.target;
        const platform = container.dataset.platform;
        const link = container.dataset.link;
        const album = container.dataset.album;
        const manualCover = container.dataset.manualCover;

        obs.unobserve(container);

        if (manualCover && manualCover !== '') {
          let fallback = '';
          if (platform === 'youtube') {
            const ytId = extractYouTubeId(link);
            if (ytId) fallback = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
          }
          if (!fallback && manualCover.includes('/tapas/')) {
            const fileName = manualCover.split('/tapas/')[1];
            fallback = `tapas/${fileName}`;
          }

          const img = document.createElement('img');
          img.src = manualCover;
          img.alt = album;
          img.className = 'loaded';
          img.onerror = function() {
            if (fallback && this.src !== fallback) {
              this.src = fallback;
            } else {
              this.onerror = null;
              container.innerHTML = '<div class="cover-placeholder">Sin carátula</div>';
            }
          };
          container.innerHTML = '';
          container.appendChild(img);
          return;
        }

        if (platform === 'youtube') {
          const ytId = extractYouTubeId(link);
          if (ytId) {
            const ytImg = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
            const fallbackImg = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
            container.innerHTML = `<img src="${ytImg}" alt="${album}" class="loaded" onerror="this.onerror=function(){this.parentElement.innerHTML='<div class=\\'cover-placeholder\\'>Sin carátula</div>';}; this.src='${fallbackImg}';">`;
          }
        } else if (platform === 'spotify' || platform === 'bandcamp' || platform === 'soundcloud') {
          const cleanLink = link.split('?')[0];
          if (coverCache[cleanLink] || coverCache[link]) {
            container.innerHTML = `<img src="${coverCache[cleanLink] || coverCache[link]}" alt="${album}" class="loaded">`;
          } else {
            requestQueue.push({ container, platform, link, album });
            processQueue();
          }
        }
      }
    });
  }, { rootMargin: '200px 0px' });
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;

  const { container, platform, link, album } = requestQueue.shift();
  let imgUrl = null;

  if (platform === 'spotify') {
    imgUrl = await fetchSpotifyCover(link);
    if (imgUrl && headerMosaic && headerMosaic.children.length < 12) updateHeaderMosaic();
  } else if (platform === 'bandcamp') {
    imgUrl = await fetchBandcampCover(link);
    if (imgUrl && headerMosaic && headerMosaic.children.length < 12) updateHeaderMosaic();
  } else if (platform === 'soundcloud') {
    imgUrl = await fetchSoundCloudCover(link);
    if (imgUrl && headerMosaic && headerMosaic.children.length < 12) updateHeaderMosaic();
  }

  if (imgUrl && container) {
    container.innerHTML = `<img src="${imgUrl}" alt="${album}" class="loaded" onerror="this.parentElement.innerHTML='<div class=\\'cover-placeholder\\'>Sin carátula</div>';">`;
  }

  setTimeout(() => {
    isProcessing = false;
    processQueue();
  }, 200);
}

function renderAlbums() {
  grid.innerHTML = '';
  initObserver();

  let filtered = rawData.filter(([artist, album, year, link, manualCover, tracklist, id, location, crew, resena]) => {
    const decadeMap = { '90s': [1990, 1999], '00s': [2000, 2009], '10s': [2010, 2019], '20s': [2020, 2029] };
    const y = parseInt(year) || 0;

    if (currentFilter !== 'all') {
      if (currentFilter === 'sin-fecha') { if (y !== 0) return false; }
      else if (currentFilter === 'resenas') { if (!resena) return false; }
      else {
        const range = decadeMap[currentFilter];
        if (!range || y < range[0] || y > range[1]) return false;
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = `${artist} ${album} ${year} ${location} ${crew}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    const indexA = a[6];
    const indexB = b[6];
    const yearA = parseInt(a[2]) || 0;
    const yearB = parseInt(b[2]) || 0;

    if (currentSort === 'desc') return indexB - indexA;
    if (currentSort === 'year-desc') {
      if (yearA === 0 && yearB === 0) return indexB - indexA;
      if (yearA === 0) return 1;
      if (yearB === 0) return -1;
      if (yearB !== yearA) return yearB - yearA;
      return indexB - indexA;
    }
    if (currentSort === 'asc') {
      if (yearA === 0 && yearB === 0) return indexB - indexA;
      if (yearA === 0) return 1;
      if (yearB === 0) return -1;
      if (yearA !== yearB) return yearA - yearB;
      return indexB - indexA;
    }
    if (currentSort === 'alpha') return a[0].localeCompare(b[0], 'es');
    return 0;
  });

  statsDisplay.textContent = `Mostrando ${filtered.length} de ${rawData.length} discos`;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">No se encontraron resultados para tu búsqueda.</div>`;
    return;
  }

  filtered.forEach(([artist, album, year, link, manualCover, tracklist, id, location, crew]) => {
    const card = document.createElement('div');
    card.className = 'card';
    const platform = getPlatform(link);

    card.innerHTML = `
      <div class="cover-container" data-platform="${platform}" data-link="${link}" data-album="${album}" data-manual-cover="${manualCover || ''}" data-tracklist="${tracklist.replace(/"/g, '&quot;')}">
        <div class="cover-placeholder">Sin carátula</div>
      </div>
      <div class="card-body">
        <div>
          <div class="meta-row">
            <span class="year-badge" title="Filtrar por año ${year || 'S/D'}" data-year="${year || ''}">${year || 'S/D'}</span>
          </div>
          <h3 class="album-title">${album}</h3>
          <div class="artist-links">${formatArtistLinks(artist)}</div>
        </div>
        <div>
          <span class="btn btn-active">Ver ficha y escuchar →</span>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('artist-tag') || e.target.classList.contains('year-badge')) return;
      window.location.href = `disco/${id}`;
    });

    const coverEl = card.querySelector('.cover-container');
    if (platform !== 'none' || (manualCover && manualCover !== '')) {
      observer.observe(coverEl);
    }

    const yearBadge = card.querySelector('.year-badge');
    if (yearBadge && year) {
      yearBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        searchInput.value = year;
        searchQuery = year;
        currentFilter = 'all';
        filterButtons.forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
        updateURLParams();
        renderAlbums();
        window.scrollTo({ top: 120, behavior: 'smooth' });
      });
    }

    card.querySelectorAll('.artist-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        const selectedArtist = tag.dataset.artist;
        searchInput.value = selectedArtist;
        searchQuery = selectedArtist;
        currentFilter = 'all';
        filterButtons.forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
        updateURLParams();
        renderAlbums();
        window.scrollTo({ top: 120, behavior: 'smooth' });
      });
    });

    grid.appendChild(card);
  });
}

async function init() {
  try {
    const response = await fetch(SHEET_CSV_URL + '&_cb=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('Error al conectar con la planilla');
    const csvText = await response.text();
    const rows = parseCSV(csvText);
    rawData = processSheetRows(rows);
    updateHeaderMosaic();

    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.has('q')) {
      searchQuery = urlParams.get('q');
      searchInput.value = searchQuery;
    }

    if (urlParams.has('filtro')) {
      const paramFilter = urlParams.get('filtro');
      const targetBtn = document.querySelector(`.filter-btn[data-filter="${paramFilter}"]`);
      if (targetBtn) {
        filterButtons.forEach(b => b.classList.remove('active'));
        targetBtn.classList.add('active');
        currentFilter = paramFilter;
      }
    }

    if (urlParams.has('orden')) {
      const paramSort = urlParams.get('orden');
      if (['alpha', 'asc', 'desc', 'year-desc'].includes(paramSort)) {
        currentSort = paramSort;
        sortSelect.value = paramSort;
      }
    }

    renderAlbums();
  } catch (err) {
    statsDisplay.textContent = 'Error al cargar los datos desde Google Sheets.';
  }
}

window.addEventListener('resize', () => {
  clearTimeout(window.mosaicResizeTimer);
  window.mosaicResizeTimer = setTimeout(updateHeaderMosaic, 250);
});

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  updateURLParams();
  renderAlbums();
});

sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  updateURLParams();
  renderAlbums();
});

filterButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    filterButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    updateURLParams();
    renderAlbums();
  });
});

init();

