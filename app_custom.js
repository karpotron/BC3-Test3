
// app_custom.js - Custom parser + navigation per user's spec
const fileInput = document.getElementById('fileInput');
const status = document.getElementById('status');
const listContainer = document.getElementById('listContainer');
const breadcrumb = document.getElementById('breadcrumb');
const upBtn = document.getElementById('upBtn');
const detailModal = document.getElementById('detailModal');
const detailContent = document.getElementById('detailContent');
const closeDetail = document.getElementById('closeDetail');

let rootTree = null;
let navStack = []; // stack of nodes representing the path

fileInput.addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status.textContent = `Leyendo ${f.name}...`;
  const buf = await f.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8').decode(buf); if(!text.includes('~')) throw 'no-tilde'; }
  catch(_) { text = new TextDecoder('iso-8859-1').decode(buf); }
  rootTree = buildTreeFromBC3(text);
  navStack = [rootTree];
  renderCurrent();
  status.textContent = 'Parseado.';
});

// Build tree using specific rules: chapters coded A01, A02... sublevels may exist
function buildTreeFromBC3(text) {
  text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines = text.split('\n');
  const records = [];
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith('~')) { if (cur) records.push(cur); cur = ln; }
    else { if (cur===null) { if (ln.trim()==='') continue; cur=ln; } else cur += '\n'+ln; }
  }
  if (cur) records.push(cur);

  const T = [], C = {}, M = [];
  for (const r of records) {
    const m = r.match(/^~([A-Z0-9_]+)\|(.*)$/s);
    if (!m) continue;
    const tag = m[1], rest = m[2];
    const fields = rest.split('|');
    if (tag==='T') T.push(fields);
    else if (tag==='C') C[fields[0]] = fields; // keep last occurrence
    else if (tag==='M') M.push({raw:r, fields});
  }

  // Build nodes for T entries preserving order
  // Normalize code (remove trailing #)
  const normalize = s => (s||'').toString().replace('#','').trim();
  const nodes = T.map((f, idx) => ({code: normalize(f[0]), title: (f[1]||''), children: [], partidas: [], _idx: idx}));

  // Insert logic: top-level chapters are codes starting with A (A01, A02...)
  const roots = [];
  const byCode = {};
  for (const n of nodes) { byCode[n.code]=n; }
  for (const n of nodes) {
    if (/^A\d{2}/.test(n.code)) {
      // top-level candidate; if its code has dot or suffix, attach to parent
      const parts = n.code.split('.');
      if (parts.length>1) {
        const parentCode = parts[0];
        if (byCode[parentCode]) byCode[parentCode].children.push(n);
        else roots.push(n);
      } else {
        roots.push(n);
      }
    } else {
      // not Axx: try attach to nearest earlier Axx that is prefix
      let attached=false;
      for (const r of roots) {
        if (n.code.startsWith(r.code)) { r.children.push(n); attached=true; break; }
      }
      if (!attached) roots.push(n);
    }
  }

  // Attach partidas from C: we expect partida codes like ADE002, DSC020 etc.
  const partidas = [];
  for (const code in C) {
    const fields = C[code];
    const unidad = fields[1]||'';
    const desc = fields[2]||'';
    const precio = fields[3]||'';
    partidas.push({code, unidad, desc, precio, mediciones:[]});
  }
  // Attach partidas to nodes: for each partida, find the deepest node whose code is prefix of partida code,
  // or find node whose title matches common names (like MADERA/HORMIGON) (heuristic)
  function findBestNodeForPart(code) {
    // prefer exact match
    if (byCode[code]) return byCode[code];
    // try longest prefix match among all nodes
    let best=null, bestLen=0;
    for (const k in byCode) {
      if (k && code.startsWith(k) && k.length>bestLen) { best=byCode[k]; bestLen=k.length; }
    }
    if (best) return best;
    // otherwise look in roots
    for (const r of roots) {
      if (code.startsWith(r.code)) return r;
      for (const c of r.children) if (code.startsWith(c.code)) return c;
    }
    return null;
  }
  for (const p of partidas) {
    const node = findBestNodeForPart(p.code);
    if (node) node.partidas.push(p);
    else {
      // try match by title keywords
      let placed=false;
      for (const r of roots) {
        if (r.title && p.desc && p.desc.toLowerCase().includes(r.title.toLowerCase())) { r.partidas.push(p); placed=true; break; }
      }
      if (!placed) roots.push({code:p.code,title:p.desc,children:[],partidas:[p]});
    }
  }

  // Parse M records to extract totals and attach to partidas
  for (const m of M) {
    const raw = m.raw;
    // find partida code inside raw by searching list
    for (const p of partidas) {
      if (raw.includes(p.code)) {
        // heuristic: last numeric token is total
        const nums = Array.from(raw.matchAll(/[-+]?\d+[.,]?\d*/g)).map(x=>x[0].replace(',','.')).map(Number);
        let total = null;
        if (nums.length) total = nums[nums.length-1];
        // also if fields contain a numeric field
        for (const f of m.fields) {
          const fn = f.replace(',','.').trim();
          if (/^-?\d+(\.\d+)?$/.test(fn)) { total = parseFloat(fn); break; }
        }
        if (total!==null) p.mediciones.push({raw,total});
        break;
      }
    }
  }

  return {roots};
}

// Rendering and navigation
function renderCurrent() {
  listContainer.innerHTML = '';
  const current = navStack[navStack.length-1];
  // breadcrumb
  breadcrumb.textContent = navStack.map(n=>n.title || n.code || 'Inicio').join(' › ');
  upBtn.style.display = navStack.length>1 ? 'inline-block' : 'none';
  // show children nodes and partidas
  // first children
  if (current.children && current.children.length) {
    for (const c of current.children) {
      const el = document.createElement('div'); el.className='node';
      const left = document.createElement('div'); left.className='left';
      left.innerHTML = `<strong>${c.title||c.code}</strong><div class="codeTag">${c.code}</div>`;
      const right = document.createElement('div'); right.className='right';
      right.innerHTML = `${c.partidas.length} partidas`;
      el.appendChild(left); el.appendChild(right);
      el.onclick = ()=> { navStack.push(c); renderCurrent(); };
      listContainer.appendChild(el);
    }
  }
  // then partidas at this level
  if (current.partidas && current.partidas.length) {
    for (const p of current.partidas) {
      const el = document.createElement('div'); el.className='node';
      const left = document.createElement('div'); left.className='left';
      left.innerHTML = `<strong>${p.desc}</strong><div class="codeTag">${p.code}</div>`;
      const right = document.createElement('div'); right.className='right';
      // calculate total from mediciones
      const total = (p.mediciones||[]).reduce((s,m)=>s+(m.total||0),0);
      const precio = parseFloat((p.precio||'').replace(',','.'))||0;
      const importe = precio && total ? (precio*total).toFixed(2) : '';
      // display: cantidad · precio · importe (in that order)
      right.innerHTML = `<div>${total} ${p.unidad || ''}</div><div>${precio?precio.toFixed(2):''}</div><div>${importe}</div>`;
      const btn = document.createElement('button'); btn.className='button'; btn.textContent='Detalle';
      btn.onclick = (ev)=>{ ev.stopPropagation(); showDetail(p); };
      el.appendChild(left); el.appendChild(right); el.appendChild(btn);
      listContainer.appendChild(el);
    }
  }
}

upBtn.addEventListener('click', ()=> { if (navStack.length>1) { navStack.pop(); renderCurrent(); } });

function showDetail(p) {
  detailModal.classList.remove('hidden');
  let html = `<h3>${p.desc} — ${p.code}</h3>`;
  html += `<div class="sectionCard"><div class="detailRow"><div>Cantidad total</div><div>${(p.mediciones||[]).reduce((s,m)=>s+(m.total||0),0)}</div></div>`;
  html += `<div class="detailRow"><div>Precio unitario</div><div>${p.precio||''}</div></div>`;
  const total = (p.mediciones||[]).reduce((s,m)=>s+(m.total||0),0);
  const precio = parseFloat((p.precio||'').replace(',','.'))||0;
  html += `<div class="detailRow"><div>Importe</div><div>${precio && total ? (precio*total).toFixed(2) : ''}</div></div></div>`;
  if (p.mediciones && p.mediciones.length) {
    html += '<h4>Mediciones</h4>';
    for (const m of p.mediciones) html += `<div class="sectionCard"><div>${m.total}</div><pre style="white-space:pre-wrap">${m.raw}</pre></div>`;
  }
  detailContent.innerHTML = html;
}
closeDetail.addEventListener('click', ()=> detailModal.classList.add('hidden'));
