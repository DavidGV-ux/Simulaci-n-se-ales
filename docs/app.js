/* UI del simulador web (Chart.js + Sim) */
(function(){
  'use strict';
  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const state = { module:'am', charts:[] };

  const INFO = {
    am: { title:'AM — Modulación de amplitud', desc:'La amplitud de la portadora sigue la señal moduladora. Compara detector de envolvente y coherente.' },
    ask:{ title:'ASK / OOK — Amplitud conmutada', desc:'El bit 1 transmite portadora y el bit 0 la suprime. Observa forma de onda, espectro y BER.' },
    fsk:{ title:'FSK — Frecuencia conmutada', desc:'Cada bit selecciona un tono (f0/f1). Observa frecuencia estimada, espectro y BER.' },
    pcm:{ title:'PCM — Pulsos codificados', desc:'Muestreo, cuantificación, codificación, transmisión digital y reconstrucción con umbral.' }
  };

  function fmt(v, d=3){ if(v==null || !isFinite(v)) return '—'; const a=Math.abs(v); if(a>=1e6) return (v/1e6).toFixed(2)+'M'; if(a>=1e4) return (v/1e3).toFixed(2)+'k'; if(a>=100) return v.toFixed(1); if(a>=1) return v.toPrecision(d); if(a===0) return '0'; return v.toPrecision(d); }
  function downsample(x, y, maxN){ if(x.length<=maxN) return {x:Array.from(x),y:Array.from(y)}; const step=Math.ceil(x.length/maxN); const xo=[],yo=[]; for(let i=0;i<x.length;i+=step){ xo.push(x[i]); yo.push(y[i]); } return {x:xo,y:yo}; }
  function xy(x,y,maxN){ const d=downsample(x,y,maxN||1200); return d.x.map((v,i)=>({x:v,y:d.y[i]})); }

  function field(id,label,type,opts={}){
    const v = opts.value ?? '';
    const extra = opts.step!=null?`step="${opts.step}"`:'';
    const attrs = opts.min!=null?`min="${opts.min}"`:'';
    const attrs2 = opts.max!=null?`max="${opts.max}"`:'';
    if(type==='select'){
      const options=(opts.options||[]).map(o=>`<option value="${o.value}" ${String(o.value)===String(v)?'selected':''}>${o.label}</option>`).join('');
      return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options}</select></div>`;
    }
    if(type==='check') return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="checkbox" ${v?'checked':''} style="width:auto"/></div>`;
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${v}" ${extra} ${attrs} ${attrs2}/></div>`;
  }
  function group(title, inner){ return `<div class="group"><h4>${title}</h4>${inner}</div>`; }

  const SCHEMAS = {
    am: ()=>[
      group('Señal', field('fm','fm (Hz)','number',{value:1000,step:50}) + field('wave','Forma','select',{value:'sine',options:[{value:'sine',label:'Senoidal'},{value:'square',label:'Cuadrada'},{value:'triangle',label:'Triangular'},{value:'sawtooth',label:'Diente de sierra'},{value:'two_tone',label:'Dos tonos'}]}) + field('dur','Duración (ms)','number',{value:10,step:1,min:2,max:50})),
      group('Modulación AM', field('m','Índice m','number',{value:0.8,step:0.05,min:0,max:2}) + field('Vp','Vp (V)','number',{value:1,step:0.1}) + field('fc','fc (Hz)','number',{value:20000,step:1000}) + field('fs','fs simulación (Hz)','number',{value:400000,step:10000})),
      group('Canal', field('snr','SNR nominal banda (dB)','number',{value:20,step:1}) + field('dist','Distancia (km)','number',{value:0,step:0.1,min:0}) + field('chf','Frecuencia enlace (MHz)','number',{value:2450,step:50}) + field('att','Atenuación extra (dB)','number',{value:0,step:1}) + field('intOn','Interferencia','check',{value:false}) + field('intF','Freq. interferencia (Hz)','number',{value:24000,step:100}) + field('intA','Amp. interferencia (dB)','number',{value:-6,step:1}))
    ].join(''),
    ask: ()=>[
      group('Bits y modulación', field('nbits','Nº bits','number',{value:1200,step:100,min:32,max:8000}) + field('rb','Rb (bit/s)','number',{value:1000,step:100}) + field('fc','fc (Hz)','number',{value:6000,step:500}) + field('sps','Muestras/bit','number',{value:24,step:2,min:8}) + field('det','Detector','select',{value:'coherent',options:[{value:'coherent',label:'Coherente'},{value:'envelope',label:'Envolvente'}]}) + field('bitsrc','Fuente bits','select',{value:'random',options:[{value:'random',label:'Aleatoria'},{value:'alternating',label:'Alternada'},{value:'manual',label:'Manual'}]}) + field('manual','Bits manuales','text',{value:'1011001011100101'})),
      group('Canal', field('ebn0','Eb/N0 nominal (dB)','number',{value:10,step:1}) + field('dist','Distancia (km)','number',{value:0,step:0.1}) + field('chf','Frecuencia enlace (MHz)','number',{value:2450,step:50}) + field('att','Atenuación extra (dB)','number',{value:0,step:1}) + field('intOn','Interferencia','check',{value:false}) + field('intF','Freq. interferencia (Hz)','number',{value:6500,step:100}) + field('intA','Amp. interferencia (dB)','number',{value:-6,step:1}))
    ].join(''),
    fsk: ()=>[
      group('Bits y modulación', field('nbits','Nº bits','number',{value:1200,step:100,min:32,max:8000}) + field('rb','Rb (bit/s)','number',{value:1000,step:100}) + field('fc','fc central (Hz)','number',{value:6000,step:500}) + field('h','Índice h','number',{value:1,step:0.1,min:0.2,max:3}) + field('sps','Muestras/bit','number',{value:24,step:2,min:8}) + field('det','Detector','select',{value:'noncoherent',options:[{value:'noncoherent',label:'No coherente'},{value:'coherent',label:'Coherente'}]}) + field('bitsrc','Fuente bits','select',{value:'random',options:[{value:'random',label:'Aleatoria'},{value:'alternating',label:'Alternada'},{value:'manual',label:'Manual'}]}) + field('manual','Bits manuales','text',{value:'1011001011100101'})),
      group('Canal', field('ebn0','Eb/N0 nominal (dB)','number',{value:10,step:1}) + field('dist','Distancia (km)','number',{value:0,step:0.1}) + field('att','Atenuación extra (dB)','number',{value:0,step:1}) + field('cfo','CFO (Hz)','number',{value:0,step:10}) + field('mpOn','Multitrayecto','check',{value:false}) + field('mpD','Retardo eco (µs)','number',{value:400,step:10}) + field('mpG','Ganancia eco (dB)','number',{value:-3,step:1}))
    ].join(''),
    pcm: ()=>[
      group('Señal analógica', field('fm','fm (Hz)','number',{value:1000,step:50}) + field('wave','Forma','select',{value:'sine',options:[{value:'sine',label:'Senoidal'},{value:'square',label:'Cuadrada'},{value:'triangle',label:'Triangular'},{value:'two_tone',label:'Dos tonos'}]}) + field('A','Amplitud (V)','number',{value:0.8,step:0.05,min:0.05,max:1})),
      group('PCM', field('fsS','fs muestreo (Hz)','number',{value:8000,step:500}) + field('nb','Bits/muestra','number',{value:8,step:1,min:2,max:12}) + field('dur','Duración (ms)','number',{value:20,step:1,min:5,max:60}) + field('FS','Fondo escala (V)','number',{value:1,step:0.1}) + field('aa','Antialias','check',{value:true})),
      group('Enlace digital', field('scheme','Esquema','select',{value:'BPSK',options:[{value:'BPSK',label:'BPSK'},{value:'ASK',label:'ASK'},{value:'FSK',label:'FSK'}]}) + field('ebn0','Eb/N0 nominal (dB)','number',{value:12,step:1}) + field('dist','Distancia (km)','number',{value:0,step:0.1}) + field('att','Atenuación extra (dB)','number',{value:0,step:1}))
    ].join('')
  };

  function v(id){ const e=document.getElementById(id); if(!e) return undefined; if(e.type==='checkbox') return e.checked; if(e.type==='number') return +e.value; return e.value; }

  function destroyCharts(){ state.charts.forEach(c=>{ try{c.destroy();}catch(_){}}); state.charts=[]; }
  function mkChart(container, title, config, interpretation){
    const box=document.createElement('div'); box.className='chart-box' + (config._tall?' tall':'');
    box.innerHTML=`<div class="chart-title">${title}</div><canvas></canvas><div class="interp"><b>Interpretación:</b> ${interpretation}</div>`;
    container.appendChild(box);
    const ctx=box.querySelector('canvas').getContext('2d');
    const base={responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{labels:{boxWidth:10,color:'#526277',font:{size:11}}},tooltip:{backgroundColor:'rgba(255,255,255,.96)',titleColor:'#182230',bodyColor:'#526277',borderColor:'#dce4ec',borderWidth:1,callbacks:{afterBody:(items)=>{ const it=items[0]; return it?`\n${interpretation}`:''; }}}}};
    config.options = Object.assign({}, base, config.options||{});
    if(config.options.plugins) config.options.plugins = Object.assign({}, base.plugins, config.options.plugins);
    const c=new Chart(ctx, config); state.charts.push(c); return c;
  }

  function setMetrics(items){
    const el=$('#metrics'); el.innerHTML=items.map(m=>`<div class="metric"><div class="k">${m.k}</div><div class="v" style="color:${m.c||'var(--ink)'}">${m.v}</div><div class="h">${m.h||''}</div></div>`).join('');
  }

  function runAM(){
    const r=Sim.simulateAM({fm:v('fm'),waveform:v('wave'),duration:v('dur')/1000,m:v('m'),Vp:v('Vp'),fc:v('fc'),fs:v('fs'),snrDb:v('snr'),distanceKm:v('dist'),channelFreqMhz:v('chf'),extraAttenDb:v('att'),interference:v('intOn'),intFreqHz:v('intF'),intAmpDb:v('intA'),seed:1});
    const met=r.metrics;
    setMetrics([{k:'Índice m',v:fmt(met.m,3),h:met.over?'sobremodulación':'m = Vm/Vp',c:met.over?'var(--red)':'var(--accent)'},{k:'Pt / Pc',v:fmt(met.ptPc,3),h:`portadora ${fmt(met.carrierFrac*100,3)} %`},{k:'MSE envolvente',v:fmt(met.mseEnv,3),h:`corr ${fmt(met.corrEnv,3)}`},{k:'MSE coherente',v:fmt(met.mseCoh,3),h:`SNR ef. ${fmt(met.snrEffDb,3)} dB`}]);
    const C=$('#charts'); destroyCharts(); C.innerHTML='';
    const ms=Array.from(r.t,x=>x*1000), zoom=ms.map((x,i)=>[x,i]).filter(p=>p[0]<=4/v('fm')*1000).map(p=>p[1]);
    const pick=(arr)=>zoom.map(i=>({x:ms[i],y:arr[i]}));
    mkChart(C,'Recuperación de la señal',{type:'line',data:{datasets:[{label:'m(t) original',data:pick(r.msg),borderColor:'#334155',pointRadius:0,borderWidth:2},{label:'envolvente',data:pick(r.env),borderColor:'#15803d',pointRadius:0,borderWidth:1.3},{label:'coherente',data:pick(r.coh),borderColor:'#2563eb',pointRadius:0,borderWidth:1.2,borderDash:[4,3]}]},options:{scales:{x:{type:'linear',title:{display:true,text:'tiempo (ms)'}},y:{title:{display:true,text:'amplitud norm.'}}}}},
      'Compara la moduladora con lo recuperado. Idealmente coinciden. En sobremodulación (m>1) la envolvente se distorsiona más que la coherente; el ruido aleja ambas curvas.');
    mkChart(C,'Espectro (TX/RX)',{type:'line',data:{datasets:[{label:'TX',data:xy(r.specTx.f.map(x=>x/1000),r.specTx.db,900),borderColor:'#0f766e',pointRadius:0,borderWidth:1.3},{label:'RX',data:xy(r.specRx.f.map(x=>x/1000),r.specRx.db,900),borderColor:'#c2410c',pointRadius:0,borderWidth:1.1}]},options:{scales:{x:{type:'linear',title:{display:true,text:'frecuencia (kHz)'},max:Math.min(v('fs')/2000,(v('fc')+6*v('fm'))/1000)},y:{title:{display:true,text:'magnitud (dB)'},min:-90,max:5}}}},
      'Picos en fc y bandas laterales fc±fm (AM). Magnitud relativa al pico en dB. Ruido eleva el piso; interferencia crea picos espurios; atenuación afecta nivel útil respecto al ruido.');
    $('#globalInterp').innerHTML=`<b>Lectura AM:</b> m=${fmt(met.m,3)} (${met.over?'sobremodulación':'lineal'}), Pt/Pc=${fmt(met.ptPc,3)}. SNR efectiva en banda ≈ ${fmt(met.snrEffDb,3)} dB, atenuación total ${fmt(met.totalAttenDb,3)} dB. Si m>1, prioriza el detector coherente; si hay poca SNR, ambos degradan (sube MSE, baja correlación).`;
  }

  function runASK(){
    const r=Sim.simulateDigital({scheme:'ASK',nbits:v('nbits'),rb:v('rb'),fc:v('fc'),amplitude:1,sps:v('sps'),detector:v('det'),bitMode:v('bitsrc'),manualBits:v('manual'),seed:1,ebn0Db:v('ebn0'),distanceKm:v('dist'),channelFreqMhz:v('chf'),extraAttenDb:v('att'),interference:v('intOn'),intFreqHz:v('intF'),intAmpDb:v('intA')});
    setMetrics([{k:'BER',v:r.ber.toExponential(2),h:`${r.errors} / ${r.nbits} bits`,c:r.ber===0?'var(--green)':r.ber<0.01?'var(--amber)':'var(--red)'},{k:'Eb/N0 ef.',v:fmt(r.report.ebn0EffDb,3)+' dB',h:`nominal ${v('ebn0')} dB`},{k:'SNR banda',v:fmt(r.extras.snrBandDb,3)+' dB',h:'en banda ocupada'},{k:'Portadora',v:fmt(r.extras.fc,4)+' Hz',h:`${r.extras.cyclesPerBit||0} ciclos/bit`}]);
    const C=$('#charts'); destroyCharts(); C.innerHTML='';
    const ms=Array.from(r.t,x=>x*1000), showN=Math.min(24,r.nbits), lim=showN/r.rb*1000;
    const filt=(arr)=>arr.map((y,i)=>({x:ms[i],y})).filter(p=>p.x<=lim);
    mkChart(C,'Forma de onda ASK (TX/RX)',{type:'line',data:{datasets:[{label:'TX',data:filt(Array.from(r.tx)),borderColor:'#0f766e',pointRadius:0,borderWidth:1.1},{label:'RX',data:filt(Array.from(r.rx)),borderColor:'#c2410c',pointRadius:0,borderWidth:0.9}]},options:{scales:{x:{type:'linear',title:{display:true,text:'tiempo (ms)'}},y:{title:{display:true,text:'amplitud'}}}}},
      'OOK: bit 1 genera portadora, bit 0 silencio. RX incluye ruido/atenuación/factores; errores ocurren cuando el ruido cruza el umbral de decisión.');
    mkChart(C,'Espectro ASK',{type:'line',data:{datasets:[{label:'TX',data:xy(r.specTx.f.map(x=>x/1000),r.specTx.db,900),borderColor:'#0f766e',pointRadius:0,borderWidth:1.2}]},options:{scales:{x:{type:'linear',title:{display:true,text:'frecuencia (kHz)'},max:Math.min(r.fs/2000,(r.extras.fc+6*r.rb)/1000)},y:{title:{display:true,text:'magnitud (dB)'},min:-85,max:5}}}},
      'Lóbulos tipo sinc alrededor de fc, separados por múltiplos de Rb. Ancho principal ~2Rb. Interferencia aparece como pico adicional; ruido eleva el piso.');
    $('#globalInterp').innerHTML=`<b>Lectura ASK:</b> BER=${r.ber.toExponential(2)} con Eb/N0 efectivo ${fmt(r.report.ebn0EffDb,3)} dB. A menor Eb/N0 o con atenuación/interferencia, la decisión de umbral falla más. El detector coherente suele rendir mejor que envolvente en AWGN ideal.`;
  }

  function runFSK(){
    const r=Sim.simulateDigital({scheme:'FSK',nbits:v('nbits'),rb:v('rb'),fc:v('fc'),h:v('h'),amplitude:1,sps:v('sps'),detector:v('det'),bitMode:v('bitsrc'),manualBits:v('manual'),seed:1,ebn0Db:v('ebn0'),distanceKm:v('dist'),channelFreqMhz:2450,extraAttenDb:v('att'),freqOffsetHz:v('cfo'),multipath:v('mpOn'),mpDelayUs:v('mpD'),mpGainDb:v('mpG'),mpPhaseDeg:180});
    const e=r.extras;
    setMetrics([{k:'BER',v:r.ber.toExponential(2),h:`${r.errors} / ${r.nbits} bits`,c:r.ber===0?'var(--green)':r.ber<0.01?'var(--amber)':'var(--red)'},{k:'Eb/N0 ef.',v:fmt(r.report.ebn0EffDb,3)+' dB',h:`nominal ${v('ebn0')} dB`},{k:'Índice h',v:fmt(e.h,3),h:`Δf ${fmt(e.df,3)} Hz`},{k:'BW (Carson)',v:fmt(e.bandwidthHz/1000,3)+' kHz',h:`f0/f1 ${fmt(e.f0,4)}/${fmt(e.f1,4)} Hz`}]);
    const C=$('#charts'); destroyCharts(); C.innerHTML='';
    const ms=Array.from(r.t,x=>x*1000), showN=Math.min(28,r.nbits), lim=showN/r.rb*1000;
    const filt=(arr)=>arr.map((y,i)=>({x:ms[i],y})).filter(p=>p.x<=lim);
    // frecuencia estimada por bit (pendiente de fase)
    const ph=Sim && (function(){ // Hilbert phase approx using analytic in sim is internal; compute via JS FFT? use simple inst frequency from zero crossings proxy not ideal; reuse analytic
      // acceso indirecto: implementar rápido aquí
      return null; })();
    // fallback: mostrar envolvente de comparación / tono esperado no trivial; usaremos espectro y forma de onda + interpretación clara
    mkChart(C,'Forma de onda FSK (TX/RX)',{type:'line',data:{datasets:[{label:'TX',data:filt(Array.from(r.tx)),borderColor:'#0f766e',pointRadius:0,borderWidth:1.0},{label:'RX',data:filt(Array.from(r.rx)),borderColor:'#c2410c',pointRadius:0,borderWidth:0.85}]},options:{scales:{x:{type:'linear',title:{display:true,text:'tiempo (ms)'}},y:{title:{display:true,text:'amplitud'}}}}},
      'Cada bit usa una frecuencia distinta (f0 o f1). La amplitud idealmente es constante; el ruido y el canal alteran la forma y pueden causar decisiones erróneas.');
    mkChart(C,'Espectro FSK',{type:'line',data:{datasets:[{label:'TX',data:xy(r.specTx.f.map(x=>x/1000),r.specTx.db,900),borderColor:'#0f766e',pointRadius:0,borderWidth:1.2}]},options:{scales:{x:{type:'linear',title:{display:true,text:'frecuencia (kHz)'},min:Math.max(0,(e.f0-4*r.rb)/1000),max:(e.f1+4*r.rb)/1000},y:{title:{display:true,text:'magnitud (dB)'},min:-85,max:5}}}},
      'Energía concentrada cerca de f0 y f1. La separación depende de h·Rb/2. CFO desplaza la señal en frecuencia; ruido ensucia los tonos y aumenta BER.');
    $('#globalInterp').innerHTML=`<b>Lectura FSK:</b> h=${fmt(e.h,3)}, Δf=${fmt(e.df,3)} Hz, BW≈${fmt(e.bandwidthHz/1000,3)} kHz. BER=${r.ber.toExponential(2)} (Eb/N0 ef. ${fmt(r.report.ebn0EffDb,3)} dB). Detector no coherente es robusto a fase; CFO/multitrayecto pueden degradarlo.`;
  }

  function runPCM(){
    const r=Sim.simulatePCM({fm:v('fm'),waveform:v('wave'),amplitude:v('A'),fsSample:v('fsS'),nBits:v('nb'),duration:v('dur')/1000,fullScale:v('FS'),antialias:v('aa'),scheme:v('scheme'),ebn0Db:v('ebn0'),distanceKm:v('dist'),channelFreqMhz:2450,extraAttenDb:v('att'),sps:12,seed:1});
    setMetrics([{k:'SQNR rec.',v:fmt(r.sqnr,3)+' dB',h:`teoría ${fmt(r.sqnrTh,3)} dB`,c:r.sqnr>r.sqnrQ-6?'var(--green)':r.sqnr>15?'var(--amber)':'var(--red)'},{k:'SQNR cuant.',v:fmt(r.sqnrQ,3)+' dB',h:`q=${fmt(r.q*1000,3)} mV`},{k:'BER enlace',v:r.ber.toExponential(2),h:`${r.errors}/${r.nbitsTotal} bits`,c:r.ber===0?'var(--green)':r.ber<0.01?'var(--amber)':'var(--red)'},{k:'Rb',v:fmt(r.rb/1000,3)+' kbit/s',h:r.alias?'¡aliasing!':`Nyquist ${fmt(r.nyquist,4)} Hz`,c:r.alias?'var(--red)':'var(--ink)'}]);
    const C=$('#charts'); destroyCharts(); C.innerHTML='';
    const msA=Array.from(r.tA,x=>x*1000), msS=Array.from(r.tS,x=>x*1000), lim=Math.min(v('dur'),10);
    const edge=Math.min(v('dur')*0.3, 4/v('fsS')*1000);
    mkChart(C,'Muestreo y cuantificación',{type:'line',data:{datasets:[{label:'analógica',data:xy(msA,r.xA,900).filter(p=>p.x<=lim),borderColor:'#334155',pointRadius:0,borderWidth:1.2},{label:'muestras cuantizadas',data:msS.map((x,i)=>({x,y:r.xq[i]})).filter(p=>p.x<=lim),borderColor:'#0f766e',pointRadius:2,showLine:false}]},options:{scales:{x:{type:'linear',title:{display:true,text:'tiempo (ms)'}},y:{title:{display:true,text:'amplitud (V)'}}}}},
      'La señal se muestrea a fs y cada muestra se redondea a un nivel (2^n). Si fs es baja respecto a fm aparece aliasing; si n es bajo, el escalón de cuantificación es grande.');
    mkChart(C,'Reconstrucción',{type:'line',data:{datasets:[{label:'original',data:xy(msA,r.xA,900).filter(p=>p.x>=edge&&p.x<=lim),borderColor:'#334155',pointRadius:0,borderWidth:1.3},{label:'ZOH',data:xy(msA,r.xZOH,900).filter(p=>p.x>=edge&&p.x<=lim),borderColor:'#8797a8',pointRadius:0,borderWidth:1},{label:'reconstruida (sinc)',data:xy(msA,r.xRec,900).filter(p=>p.x>=edge&&p.x<=lim),borderColor:'#c2410c',pointRadius:0,borderWidth:1.3}]},options:{scales:{x:{type:'linear',title:{display:true,text:'tiempo (ms)'}},y:{title:{display:true,text:'amplitud (V)'}}}}},
      'Compara original, retenedor de orden cero (escalones) y reconstrucción suave. Diferencias por cuantificación y, si Eb/N0 es bajo, por errores de bit (saltos grandes).');
    mkChart(C,'Espectro (aliasing / Nyquist)',{type:'line',data:{datasets:[{label:'analógica',data:xy(r.specA.f.map(x=>x/1000),r.specA.db,700),borderColor:'#334155',pointRadius:0,borderWidth:1.1},{label:'muestreada',data:xy(r.specS.f.map(x=>x/1000),r.specS.db,700),borderColor:'#0f766e',pointRadius:0,borderWidth:1.1}]},options:{scales:{x:{type:'linear',title:{display:true,text:'frecuencia (kHz)'},max:Math.min(v('fsS')/2000, Math.max(2*v('fm'),1.2*r.nyquist)/1000)},y:{title:{display:true,text:'magnitud (dB)'},min:-90,max:5}}}},
      `Nyquist = fs/2 = ${fmt(r.nyquist,4)} Hz. Si fm supera Nyquist o falta antialias, aparecen componentes plegadas (aliasing). ${r.alias?'Condición actual: hay aliasing.':'Condición actual: sin aliasing evidente.'}`);
    $('#globalInterp').innerHTML=`<b>Lectura PCM:</b> ${v('nb')} bits, fs=${fmt(v('fsS'),4)} Hz, Rb=${fmt(r.rb/1000,3)} kbit/s (${v('scheme')}). SQNR cuant. ${fmt(r.sqnrQ,2)} dB, rec. ${fmt(r.sqnr,2)} dB (teoría ${fmt(r.sqnrTh,2)} dB). BER=${r.ber.toExponential(2)}. ${r.sqnr < r.sqnrQ-8?'Predominan errores de bit (efecto umbral).':'Predomina cuantización/muestreo.'}`;
  }

  function renderModule(name){
    state.module=name; const info=INFO[name];
    $('#simTitle').textContent=info.title; $('#simDesc').textContent=info.desc; $('#moduleSelect').value=name;
    $('#controls').innerHTML=SCHEMAS[name](); $('#globalInterp').innerHTML='Pulsa <b>Simular</b> para generar las gráficas e interpretaciones.';
    destroyCharts(); $('#charts').innerHTML=''; $('#metrics').innerHTML='';
  }
  function run(){ try{ if(state.module==='am') runAM(); else if(state.module==='ask') runASK(); else if(state.module==='fsk') runFSK(); else runPCM(); } catch(e){ $('#globalInterp').innerHTML=`<b style="color:var(--red)">Error:</b> ${e.message}`; console.error(e); } }

  $('#moduleSelect').addEventListener('change', e=>renderModule(e.target.value));
  $('#runBtn').addEventListener('click', run);
  $('#resetBtn').addEventListener('click', ()=>renderModule(state.module));
  $$('.module-card').forEach(c=>c.addEventListener('click',()=>{ renderModule(c.dataset.target); location.hash='#simulador'; }));

  renderModule('am'); run();
})();
