const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(['docx', 'pptx']);
export function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes < 1) return '0 B'; const u=['B','KB','MB','GB']; const n=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),u.length-1); const v=bytes/(1024**n); return (n===0?Math.round(v):v.toFixed(v>=10?1:2))+' '+u[n]; }
export function validatePdfMakerFiles(files,currentCount=0){const accepted=[],rejected=[];for(const file of files){const ext=file.name.split('.').pop()?.toLowerCase()||'';if(!ALLOWED.has(ext))rejected.push(file.name+': only DOCX and PPTX files are supported.');else if(file.size>MAX_FILE_BYTES)rejected.push(file.name+': file exceeds 25 MB.');else if(currentCount+accepted.length>=MAX_FILES)rejected.push(file.name+': only 10 files can be converted at once.');else accepted.push(file);}return{accepted,rejected};}
const errors={UNSUPPORTED_FORMAT:'This file format is not supported.',FILE_TOO_LARGE:'This file is larger than the server limit.',INVALID_DOCUMENT:'This file is not a valid Word or PowerPoint document.',ENCRYPTED_DOCUMENT:'Password-protected documents cannot be converted.',CONVERSION_TIMEOUT:'Conversion took too long. Try a smaller document.',CONVERTER_FAILED:'The document could not be converted.',INVALID_PDF:'The converter did not produce a valid PDF.'};
const statusText=(file)=>file.error?(errors[file.error]||'Conversion failed.'):({selected:'Ready',uploading:'Uploading',queued:'Queued',converting:'Converting',succeeded:'Ready to download',failed:'Failed',expired:'Expired'}[file.status]||file.status);
export function initPdfMaker(surface,options={}){
 const fetcher=options.fetch||globalThis.fetch,delay=options.delay||((ms)=>new Promise(r=>setTimeout(r,ms)));
 const q=(s)=>surface.querySelector(s),input=q('[data-pdf-input]'),drop=q('[data-pdf-drop]'),work=q('[data-pdf-work]'),body=q('[data-pdf-files]'),summary=q('[data-pdf-summary]'),error=q('[data-pdf-error]'),live=q('[data-pdf-live]'),convert=q('[data-pdf-convert]'),clear=q('[data-pdf-clear]'),results=q('[data-pdf-results]'),resultSummary=q('[data-pdf-result-summary]'),zip=q('[data-pdf-zip]'),finish=q('[data-pdf-finish]');
 if(!input||!drop||!body||!convert)return;
 let selected=[],job=null,accessToken='',requestSerial=0,busy=false;const rowEls=new Map();
 const setError=(m='')=>{error.textContent=m;error.hidden=!m;},announce=(m)=>{live.textContent=m;},auth=()=>({Authorization:'Bearer '+accessToken});
 const button=(label,handler)=>{const n=document.createElement('button');n.type='button';n.className='ghost';n.textContent=label;n.addEventListener('click',handler);return n;};
 const download=async(url)=>{setError();const r=await fetcher(url,{headers:auth(),cache:'no-store'});if(!r.ok)throw new Error(r.status===410?'Results have expired. Convert the files again.':'The download could not be started.');const blob=await r.blob(),d=r.headers.get('content-disposition')||'',enc=d.match(/filename\*=UTF-8''([^;]+)/i)?.[1],plain=d.match(/filename="?([^";]+)"?/i)?.[1],name=enc?decodeURIComponent(enc):(plain||'download'),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(href);announce('Download started.');};
 const buildActions=(cell,file,i)=>{cell.replaceChildren();if(!job&&!busy){const btn=button('Remove',()=>{selected.splice(i,1);render();announce(file.name+' removed.');});btn.setAttribute('aria-label','Remove '+file.name);cell.append(btn);}else if(job&&file.downloadable){cell.append(button('Download PDF',()=>download('/api/pdf-maker/jobs/'+job.jobId+'/files/'+file.id).catch(c=>setError(c.message))));}};
 const actionKind=(file)=>!job&&!busy?'remove':(job&&file.downloadable?'download':'none');
 const render=()=>{
  work.hidden=selected.length===0&&!job;
  summary.textContent=selected.length+(selected.length===1?' file':' files')+' - '+formatBytes(selected.reduce((s,f)=>s+f.size,0));
  convert.disabled=busy||selected.length===0||Boolean(job);
  clear.disabled=busy;
  const rows=job?.files||selected.map((f,i)=>({id:String(i),name:f.name,status:'selected'}));
  const seen=new Set();
  rows.forEach((file,i)=>{
   seen.add(file.id);
   const source=selected[i];
   let entry=rowEls.get(file.id);
   if(!entry){
    const row=document.createElement('tr'),name=document.createElement('th'),kind=document.createElement('td'),size=document.createElement('td'),status=document.createElement('td'),actions=document.createElement('td');
    name.scope='row';name.className='pdf-name';actions.className='pdf-row-actions';
    row.append(name,kind,size,status,actions);
    entry={row,name,kind,size,status,actions,actionKind:null};
    rowEls.set(file.id,entry);
   }
   entry.name.textContent=file.name;
   entry.kind.textContent=file.name.split('.').pop()?.toUpperCase()||'Document';
   entry.size.textContent=source?formatBytes(source.size):'-';
   entry.status.className='pdf-status pdf-status-'+file.status;
   entry.status.textContent=statusText(file);
   const kind2=actionKind(file);
   if(entry.actionKind!==kind2){buildActions(entry.actions,file,i);entry.actionKind=kind2;}
   if(body.children[i]!==entry.row)body.insertBefore(entry.row,body.children[i]||null);
  });
  for(const [id,entry] of rowEls){if(!seen.has(id)){entry.row.remove();rowEls.delete(id);}}
  const terminal=job&&['succeeded','partial','failed'].includes(job.status);
  results.hidden=!terminal;
  if(terminal){const ok=job.counts.succeeded,failed=job.counts.failed;resultSummary.textContent=ok+' converted'+(failed?' - '+failed+' failed':'')+'. Results expire at '+new Date(job.expiresAt).toLocaleString()+'.';zip.hidden=ok===0;}
 };
 const add=(files)=>{if(busy||job)return;const{accepted,rejected}=validatePdfMakerFiles(Array.from(files),selected.length);selected.push(...accepted);input.value='';setError(rejected.join(' '));render();announce(accepted.length?accepted.length+' file(s) added.':'No files were added.');};
 const poll=async(serial)=>{while(serial===requestSerial&&job&&!['succeeded','partial','failed'].includes(job.status)){await delay(700);const r=await fetcher('/api/pdf-maker/jobs/'+job.jobId,{headers:auth(),cache:'no-store'});if(r.status===410){setError('This conversion has expired. Convert the files again.');job=null;accessToken='';break;}if(!r.ok){setError('Status could not be refreshed. Retrying...');continue;}job=await r.json();setError();render();}busy=false;render();if(job)announce(job.status==='partial'?'Conversion completed with some failures.':job.status==='succeeded'?'Conversion completed.':'Conversion finished without results.');};
 const start=async()=>{if(busy||job||selected.length===0)return;busy=true;setError();render();announce('Uploading files.');const data=new FormData();selected.forEach(f=>data.append('files',f,f.name));try{const r=await fetcher('/api/pdf-maker/jobs',{method:'POST',body:data,cache:'no-store'}),payload=await r.json().catch(()=>({}));if(!r.ok)throw new Error(payload.error?.message||(r.status===503?'The converter is busy. Try again shortly.':'The upload could not be accepted.'));accessToken=payload.accessToken;job=payload;const serial=++requestSerial;render();await poll(serial);}catch(c){busy=false;setError(c.message||'The conversion could not be started.');render();announce('Conversion could not be started.');}};
 const discard=async()=>{++requestSerial;if(job&&accessToken){try{await fetcher('/api/pdf-maker/jobs/'+job.jobId,{method:'DELETE',headers:auth(),cache:'no-store'});}catch{}}selected=[];job=null;accessToken='';busy=false;setError();render();announce('Completed job removed.');};
 input.addEventListener('change',()=>add(input.files));for(const t of ['dragenter','dragover'])drop.addEventListener(t,e=>{e.preventDefault();if(!busy&&!job)drop.classList.add('is-dragging');});for(const t of ['dragleave','drop'])drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('is-dragging');});drop.addEventListener('drop',e=>add(e.dataTransfer?.files||[]));document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{if(!drop.contains(e.target))e.preventDefault();});convert.addEventListener('click',start);clear.addEventListener('click',discard);finish.addEventListener('click',discard);zip.addEventListener('click',()=>download('/api/pdf-maker/jobs/'+job.jobId+'/results.zip').catch(c=>setError(c.message)));render();
}