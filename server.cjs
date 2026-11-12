const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'atlas.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=FULL;
  PRAGMA foreign_keys=ON;
  PRAGMA busy_timeout=5000;
  PRAGMA max_page_count=131072;
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, image BLOB,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS valves (
    id TEXT PRIMARY KEY, plan TEXT NOT NULL REFERENCES plans(id), seq INTEGER NOT NULL,
    x REAL, y REAL, fields TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(plan, seq)
  );
  CREATE TABLE IF NOT EXISTS regions (
    id TEXT PRIMARY KEY, plan TEXT NOT NULL REFERENCES plans(id), name TEXT NOT NULL,
    x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0
  );
`);
const fieldNames = ['name','type','model','maker','pressure','diameter','date','notes'];
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const v = fn(); db.exec('COMMIT'); return v; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}
const sheets = {'02':'汽机间 · 0.00 米层','03':'汽机间 · 4.50 米层','04':'汽机间 · 9.00 米层','05':'汽机间 · 立面图'};
transaction(() => {
  for (const [sheet,name] of Object.entries(sheets)) {
    const id='cad-0301-'+sheet;
    if (db.prepare('SELECT id FROM plans WHERE id=?').get(id)) continue;
    const image=fs.readFileSync(path.join(__dirname,'plans',sheet+'.png'));
    db.prepare("INSERT INTO plans(id,name,mime,image) VALUES(?,?,'image/png',?)").run(id,name,image);
    if (sheet!=='02') continue;
    const names=['正常疏水旁路阀','正常疏水一次阀','正常疏水二次阀','汽平衡阀','汽侧放水阀'];
    names.forEach((suffix,i)=>{
      const fields={name:'2-1#低加'+suffix,type:i===4?'截止阀':'闸阀',pressure:'1.6 MPa',
        maker:i===4?'武汉耐特阀门有限公司':'安徽省白湖阀门厂有限责任公司',
        model:i===3?'DKZ64H-16C':i===4?'DKJ61H-16C':'',
        diameter:i<3?'125 mm':'50 mm',notes:'按「汽机一楼」手写记录转录，详见手写原件。'};
      db.prepare('INSERT INTO valves(id,plan,seq,fields) VALUES(?,?,?,?)').run(randomUUID(),id,i+1,JSON.stringify(fields));
    });
  }
});

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function send(res, status, body, mime = 'application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type':mime, 'X-Content-Type-Options':'nosniff',
    'Cache-Control':'no-store', 'Referrer-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"});
  res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function read(req, limit) {
  if (Number(req.headers['content-length']) > limit) fail(413,'文件过大');
  let size=0; const chunks=[];
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>limit) fail(413,'文件过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function imageType(b) {
  if (b.length>24 && b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return 'image/png';
  if (b.length>4 && b[0]===255 && b[1]===216 && b[2]===255) return 'image/jpeg';
  if (b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') return 'image/webp';
  fail(415,'请选择 PNG、JPG 或 WebP 图纸');
}
function checkId(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) fail(400,'无效的记录编号');
}
function valves(plan) {
  return db.prepare('SELECT id,seq,x,y,fields,rev FROM valves WHERE plan=? AND deleted=0 ORDER BY seq').all(plan)
    .map(v => ({...v, fields:JSON.parse(v.fields)}));
}
function regions(plan) {
  return db.prepare('SELECT id,name,x1,y1,x2,y2,rev FROM regions WHERE plan=? AND deleted=0 ORDER BY rowid').all(plan);
}
function imageDimensions(bytes) {
  const b = Buffer.from(bytes);
  if (b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && b.length >= 24) {
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }
  if (b[0] === 255 && b[1] === 216) {
    let offset = 2;
    while (offset + 8 < b.length) {
      if (b[offset++] !== 255) break;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = b.readUInt16BE(offset);
      if (length < 2) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        return [b.readUInt16BE(offset + 5), b.readUInt16BE(offset + 3)];
      }
      offset += length;
    }
  }
  if (b.toString('ascii',0,4) === 'RIFF') {
    const format = b.toString('ascii',12,16);
    if (format === 'VP8X' && b.length >= 30) return [1+b.readUIntLE(24,3),1+b.readUIntLE(27,3)];
    if (format === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      return [(bits & 16383)+1, ((bits >>> 14) & 16383)+1];
    }
    if (format === 'VP8 ' && b.length >= 30) return [b.readUInt16LE(26)&16383,b.readUInt16LE(28)&16383];
  }
  return [null, null];
}
let exporting = false;
async function exportExcel(res, url) {
  if (exporting) fail(429,'正在生成其他导出，请稍后重试');
  const plan = url.searchParams.get('plan');
  const regionId = url.searchParams.get('region');
  const plans = db.prepare('SELECT id,name,image FROM plans ORDER BY rowid').all().filter(p => !plan || p.id === plan);
  if (!plans.length) fail(404,'图纸不存在');
  if (regionId && !plans.some(p => regions(p.id).some(r => r.id === regionId))) fail(404,'区域不存在');
  const rows = [];
  for (const p of plans) {
    const [width,height] = imageDimensions(p.image);
    const areas = regions(p.id);
    for (const v of valves(p.id)) {
      const matches = areas.filter(r => v.x !== null && v.x >= r.x1 && v.x <= r.x2 && v.y >= r.y1 && v.y <= r.y2);
      if (regionId && !matches.some(r => r.id === regionId)) continue;
      rows.push({plan:p.name,planId:p.id,width,height,...v,regions:matches.map(r => r.name).join('、')});
    }
  }
  exporting = true;
  try {
    const bytes = await new Promise((resolve,reject) => {
      const child = spawn(process.env.EXPORT_PYTHON || (process.platform==='win32'?'python':'/usr/bin/python3'),
        [path.join(__dirname,'deploy/export_excel.py')],{windowsHide:true});
      const chunks = [];
      child.stdout.on('data', c => chunks.push(c));
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      child.on('error', reject);
      child.on('close', code => code===0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Excel export failed')));
      const timer = setTimeout(() => {child.kill();reject(new Error('Excel export timeout'));},30000);
      child.on('close', () => clearTimeout(timer));
      child.stdin.end(JSON.stringify(rows));
    });
    res.setHeader('Content-Disposition','attachment; filename="valvemap.xlsx"');
    send(res,200,bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } finally { exporting = false; }
}
function validFields(input) {
  const result = {};
  for (const key of fieldNames) {
    const value = input?.[key] ?? '';
    if (typeof value!=='string' || value.length>(key==='notes'?2500:150)) fail(400,'资料过长或格式有误');
    result[key] = value.trim();
  }
  if (!result.name) fail(400,'请填写阀门名称');
  return result;
}
const assets = new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']],['/icon.png',['icon.png','image/png']]]);
assets.set('/field-note.jpg',['field-note.jpg','image/jpeg']);
let activeUploads = 0;
async function handle(req,res) {
  const url = new URL(req.url,'http://atlas.local');
  const route = url.pathname;
  if (req.method==='GET' && assets.has(route)) {
    const [file,mime]=assets.get(route);
    return send(res,200,fs.readFileSync(path.join(__dirname,'public',file)),mime);
  }
  if (route==='/api/export.xlsx' && req.method==='GET') return exportExcel(res,url);
  if (req.method!=='GET' && (req.headers['x-atlas-request']!=='1' ||
      (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host))) fail(403,'请求来源无效');
  if (route==='/api/plans' && req.method==='GET') {
    return send(res,200,db.prepare("SELECT id,name FROM plans ORDER BY CASE WHEN id LIKE 'cad-%' THEN 0 ELSE 1 END, CASE WHEN id LIKE 'cad-%' THEN id END, rowid DESC").all());
  }
  if (route==='/api/plans' && req.method==='POST') {
    const name=(url.searchParams.get('name')||'').trim(), id=url.searchParams.get('id');
    checkId(id);
    if (!name || name.length>100) fail(400,'请填写图纸名称（100 字以内）');
    if (activeUploads>=3) fail(429,'当前上传较多，请稍后重试');
    activeUploads++;
    try {
      const image=await read(req,16*1024*1024), mime=imageType(image);
      db.prepare('INSERT INTO plans(id,name,mime,image) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id,name,mime,image);
      return send(res,201,{id});
    } finally { activeUploads--; }
  }
  const match=route.match(/^\/api\/plans\/([\w-]+)\/(image|valves|regions)(?:\/([\w-]+))?$/);
  if (!match) fail(404,'找不到该页面');
  const [,plan,resource,id]=match;
  const p=db.prepare('SELECT mime FROM plans WHERE id=?').get(plan);
  if (!p) fail(404,'图纸不存在');
  if (resource==='image' && req.method==='GET' && !id) {
    const image=Buffer.from(db.prepare('SELECT image FROM plans WHERE id=?').get(plan).image);
    return send(res,200,image,p.mime);
  }
  if (resource==='regions') {
    if (!id && req.method==='GET') return send(res,200,regions(plan));
    let body;
    try { body=JSON.parse((await read(req,4096)).toString()); } catch { fail(400,'区域资料格式有误'); }
    if (!body || typeof body!=='object') fail(400,'区域资料格式有误');
    if (id && req.method==='DELETE') {
      const r=db.prepare('UPDATE regions SET deleted=1,rev=rev+1 WHERE id=? AND plan=? AND rev=? AND deleted=0').run(id,plan,Number(body.rev));
      if (!r.changes) fail(409,'区域已有变更，请刷新后重试');
      return send(res,200,{id});
    }
    if ((!id && req.method==='POST') || (id && req.method==='PUT')) {
      if (typeof body.name!=='string' || !body.name.trim() || body.name.length>100) fail(400,'请填写 100 字以内的区域名称');
      const {x1,y1,x2,y2}=body;
      if (![x1,y1,x2,y2].every(n=>Number.isFinite(n)&&n>=0&&n<=1) || x2<=x1 || y2<=y1) fail(400,'区域范围有误');
      if (id) {
        const r=db.prepare('UPDATE regions SET name=?,x1=?,y1=?,x2=?,y2=?,rev=rev+1 WHERE id=? AND plan=? AND rev=? AND deleted=0').run(body.name.trim(),x1,y1,x2,y2,id,plan,Number(body.rev));
        if (!r.changes) fail(409,'区域已有变更，请刷新后重试');
      } else {
        checkId(body.id);
        db.prepare('INSERT INTO regions(id,plan,name,x1,y1,x2,y2) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(body.id,plan,body.name.trim(),x1,y1,x2,y2);
      }
      return send(res,200,{id:id||body.id});
    }
    fail(405,'不支持的操作');
  }
  if (resource!=='valves') fail(405,'不支持的操作');
  if (!id && req.method==='GET') return send(res,200,valves(plan));
  let input;
  try { input=JSON.parse((await read(req,32*1024)).toString()); } catch(e) {if(e.status) throw e; fail(400,'无效的资料格式');}
  if (!input || typeof input!=='object') fail(400,'无效的资料格式');
  if (id && req.method==='DELETE') {
    const r=db.prepare('UPDATE valves SET deleted=1,rev=rev+1 WHERE id=? AND plan=? AND rev=? AND deleted=0').run(id,plan,Number(input.rev));
    if (!r.changes) fail(409,'该点位已有变更，请刷新并确认');
    return send(res,200,{id});
  }
  if ((!id && req.method==='POST') || (id && req.method==='PUT')) {
    const {x,y}=input, fields=JSON.stringify(validFields(input.fields));
    const pending=id && x===null && y===null && db.prepare('SELECT id FROM valves WHERE id=? AND plan=? AND x IS NULL').get(id,plan);
    if (!pending && ![x,y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)) fail(400,'点位超出图纸范围');
    if (!id) {
      checkId(input.id);
      transaction(()=> {
        const seq=db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM valves WHERE plan=?').get(plan).n;
        db.prepare('INSERT INTO valves(id,plan,seq,x,y,fields) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(input.id,plan,seq,x,y,fields);
      });
    } else {
      const r=db.prepare('UPDATE valves SET x=?,y=?,fields=?,rev=rev+1 WHERE plan=? AND id=? AND rev=? AND deleted=0').run(x,y,fields,plan,id,Number(input.rev));
      if (!r.changes) fail(409,'该点位已有变更。请复制未保存内容，关闭并刷新后重试。');
    }
    return send(res,200,{id:id||input.id});
  }
  fail(405,'不支持的操作');
}
const server=http.createServer((req,res)=>handle(req,res).catch(e=>{
  const full=e.errcode===13 || e.code==='SQLITE_FULL';
  if (!e.status) console.error(e.message);
  if (!res.headersSent) send(res,e.status || (full?507:500),{error:e.status?e.message:(full?'服务器存储已满，请联系管理员':'服务器暂时无法完成请求')});
}));
server.requestTimeout=90000;
server.listen(Number(process.env.PORT || 19999),process.env.HOST || '0.0.0.0');
