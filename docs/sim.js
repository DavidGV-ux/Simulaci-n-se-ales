/* Simulación AM/ASK/FSK/PCM en navegador (versión educativa interactiva).
   Implementa los modelos principales usados por la app Python: canal (FSL+AWGN+factores),
   AM, ASK/OOK, FSK, PCM. Usa FFT (Cooley-Tukey radix-2 con relleno). */
(function(global){
  'use strict';
  const TAU = Math.PI * 2;

  function zeros(n){ return new Float64Array(n); }
  function arange(n, start=0, step=1){ const a=new Float64Array(n); for(let i=0;i<n;i++) a[i]=start+i*step; return a; }
  function linspace(a,b,n){ const o=new Float64Array(n); const d=n>1?(b-a)/(n-1):0; for(let i=0;i<n;i++) o[i]=a+i*d; return o; }
  function mean(a){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]; return a.length?s/a.length:0; }
  function rms(a){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*a[i]; return Math.sqrt(a.length?s/a.length:0); }
  function dot(a,b){ let s=0,n=Math.min(a.length,b.length); for(let i=0;i<n;i++) s+=a[i]*b[i]; return s; }
  function clamp(x,lo,hi){ return x<lo?lo:x>hi?hi:x; }
  function add(a,b){ const o=new Float64Array(a.length); for(let i=0;i<a.length;i++) o[i]=a[i]+(b.length?b[i]:b); return o; }
  function sub(a,b){ const o=new Float64Array(a.length); for(let i=0;i<a.length;i++) o[i]=a[i]-(b.length?b[i]:b); return o; }
  function mul(a,b){ const o=new Float64Array(a.length); for(let i=0;i<a.length;i++) o[i]=a[i]*(b.length?b[i]:b); return o; }
  function scale(a,k){ const o=new Float64Array(a.length); for(let i=0;i<a.length;i++) o[i]=a[i]*k; return o; }
  function absarr(a){ const o=new Float64Array(a.length); for(let i=0;i<a.length;i++) o[i]=Math.abs(a[i]); return o; }
  function maxabs(a){ let m=0; for(let i=0;i<a.length;i++){ const v=Math.abs(a[i]); if(v>m)m=v; } return m; }
  function sliceArr(a, start, end){ return a.slice(start, end==null?a.length:end); }
  function interp1(tIn, xIn, tOut){
    const y=new Float64Array(tOut.length); const n=tIn.length;
    for(let j=0;j<tOut.length;j++){
      const t=tOut[j];
      if(t<=tIn[0]){ y[j]=xIn[0]; continue; }
      if(t>=tIn[n-1]){ y[j]=xIn[n-1]; continue; }
      let lo=0, hi=n-1; while(hi-lo>1){ const m=(lo+hi)>>1; if(tIn[m]<=t) lo=m; else hi=m; }
      const dt=tIn[hi]-tIn[lo]; const u=dt? (t-tIn[lo])/dt:0; y[j]=xIn[lo]*(1-u)+xIn[hi]*u;
    }
    return y;
  }

  // PRNG reproducible (mulberry32) + Box-Muller
  function rng(seed){ let t=seed>>>0; return function(){ t+=0x6D2B79F5; let r=Math.imul(t^(t>>>15),1|t); r^=r+Math.imul(r^(r>>>7),61|r); return ((r^(r>>>14))>>>0)/4294967296; }; }
  function randn(rand){ let u=0,v=0; while(u===0)u=rand(); while(v===0)v=rand(); return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*v); }

  // FFT radix-2
  function nextPow2(n){ let p=1; while(p<n)p<<=1; return p; }
  function fft(re, im, inverse){
    const n=re.length;
    for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ let tr=re[i]; re[i]=re[j]; re[j]=tr; let ti=im[i]; im[i]=im[j]; im[j]=ti; } }
    for(let len=2; len<=n; len<<=1){
      const ang=(inverse?2:-2)*Math.PI/len; const wlenRe=Math.cos(ang), wlenIm=Math.sin(ang);
      for(let i=0;i<n;i+=len){
        let wRe=1,wIm=0;
        for(let j=0;j<len/2;j++){
          const uRe=re[i+j], uIm=im[i+j];
          const vRe=re[i+j+len/2]*wRe - im[i+j+len/2]*wIm;
          const vIm=re[i+j+len/2]*wIm + im[i+j+len/2]*wRe;
          re[i+j]=uRe+vRe; im[i+j]=uIm+vIm;
          re[i+j+len/2]=uRe-vRe; im[i+j+len/2]=uIm-vIm;
          const nwRe=wRe*wlenRe - wIm*wlenIm; wIm=wRe*wlenIm + wIm*wlenRe; wRe=nwRe;
        }
      }
    }
    if(inverse){ for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } }
  }
  function rfft(x){
    const n=nextPow2(x.length), re=new Float64Array(n), im=new Float64Array(n); re.set(x); fft(re,im,false);
    const n2=n/2+1; const outRe=new Float64Array(n2), outIm=new Float64Array(n2);
    for(let i=0;i<n2;i++){ outRe[i]=re[i]; outIm[i]=im[i]; } return {re:outRe, im:outIm, n:n};
  }
  function irfft(specRe, specIm, nOut){
    const n=nextPow2(Math.max(nOut, (specRe.length-1)*2));
    const re=new Float64Array(n), im=new Float64Array(n);
    for(let i=0;i<specRe.length && i<=n/2;i++){ re[i]=specRe[i]; im[i]=specIm[i]; }
    for(let i=1;i<n/2;i++){ re[n-i]=re[i]; im[n-i]=-im[i]; }
    fft(re,im,true);
    return re.slice(0, nOut||n);
  }
  function analytic(x){ // Hilbert: z = x + j*H(x)
    const n=nextPow2(x.length), re=new Float64Array(n), im=new Float64Array(n); re.set(x); fft(re,im,false);
    const h=new Float64Array(n); h[0]=1; if(n%2===0) h[n/2]=1; for(let i=1;i<n/2;i++) h[i]=2;
    for(let i=0;i<n;i++){ re[i]*=h[i]; im[i]*=h[i]; }
    fft(re,im,true); return {re:re.slice(0,x.length), im:im.slice(0,x.length)};
  }
  function envelope(x){ const z=analytic(x); const e=new Float64Array(x.length); for(let i=0;i<x.length;i++) e[i]=Math.hypot(z.re[i],z.im[i]); return e; }
  function instPhase(x){ const z=analytic(x); const p=new Float64Array(x.length); let prev=0, off=0; for(let i=0;i<x.length;i++){ let a=Math.atan2(z.im[i],z.re[i]); let d=a-prev; if(i>0){ if(d>Math.PI) off-=TAU; else if(d<-Math.PI) off+=TAU; } p[i]=a+off; prev=a; } return p; }
  function lowpassFFT(x, fs, cutoff){
    cutoff=clamp(cutoff, 1, fs/2 - 1);
    const n=nextPow2(x.length), re=new Float64Array(n), im=new Float64Array(n); re.set(x); fft(re,im,false);
    for(let i=0;i<=n/2;i++){ const f=i*fs/n; if(f>cutoff){ re[i]=0; im[i]=0; if(i>0&&i<n/2){ re[n-i]=0; im[n-i]=0; } } }
    fft(re,im,true); return re.slice(0,x.length);
  }

  function spectrum(x, fs){
    const m=mean(x); const n=nextPow2(Math.max(1024,x.length)); const re=new Float64Array(n), im=new Float64Array(n);
    for(let i=0;i<x.length;i++){ const w=0.5-0.5*Math.cos(TAU*i/Math.max(1,x.length-1)); re[i]=(x[i]-m)*w; }
    fft(re,im,false);
    const n2=n/2+1; const f=new Float64Array(n2), db=new Float64Array(n2); let peak=1e-20;
    for(let i=0;i<n2;i++){ f[i]=i*fs/n; const mag=Math.hypot(re[i],im[i]); if(mag>peak) peak=mag; db[i]=mag; }
    for(let i=0;i<n2;i++) db[i]=20*Math.log10(Math.max(db[i]/peak,1e-12));
    return {f, db};
  }

  function waveform(kind, t, opts){
    const A=opts.amplitude==null?1:opts.amplitude, f=opts.frequency||1000, phase=(opts.phaseDeg||0)*Math.PI/180, duty=opts.duty==null?0.5:opts.duty;
    const x=new Float64Array(t.length);
    for(let i=0;i<t.length;i++){
      const ti=t[i], th=TAU*f*ti+phase;
      if(kind==='sine') x[i]=A*Math.sin(th);
      else if(kind==='square'){ const frac=((f*ti+(opts.phaseDeg||0)/360)%1+1)%1; x[i]=frac<duty?A:-A; }
      else if(kind==='triangle') x[i]=A*(2/Math.PI)*Math.asin(Math.sin(th));
      else if(kind==='sawtooth'){ const frac=((f*ti+(opts.phaseDeg||0)/360)%1+1)%1; x[i]=A*(2*frac-1); }
      else if(kind==='two_tone') x[i]=A*(0.62*Math.sin(th)+0.38*Math.sin(TAU*3*f*ti+phase/2));
      else x[i]=A*Math.sin(th);
    }
    const m=mean(x); for(let i=0;i<x.length;i++) x[i]-=m;
    const pk=maxabs(x)||1; for(let i=0;i<x.length;i++) x[i]/=pk;
    return x;
  }

  function fslDb(dKm, fMhz){ if(dKm<=0||fMhz<=0) return 0; return 32.45 + 20*Math.log10(dKm) + 20*Math.log10(fMhz); }
  function db2lin(db){ return Math.pow(10, db/20); }

  function applyChannel(x, fs, cfg, seed){
    const rand=rng(seed||1);
    const dist=+cfg.distanceKm||0, fMhz=+cfg.freqMhz||0, extra=+cfg.extraAttenDb||0;
    const pathLoss=fslDb(dist,fMhz), totalAtten=pathLoss+Math.max(0,extra), gain=db2lin(-totalAtten);
    let y=scale(x,gain);
    if(cfg.interference && (+cfg.intFreqHz)>0){
      const refR=rms(x)||1, amp=refR*db2lin(+cfg.intAmpDb||-20);
      for(let i=0;i<y.length;i++) y[i]+=amp*Math.cos(TAU*(+cfg.intFreqHz)*(i/fs)+0.37);
    }
    if(Math.abs(+cfg.freqOffsetHz)>1e-9){
      const df=+cfg.freqOffsetHz; const z=analytic(y);
      for(let i=0;i<y.length;i++){ const ph=TAU*df*(i/fs); y[i]=z.re[i]*Math.cos(ph)-z.im[i]*Math.sin(ph); }
    }
    if(cfg.multipath && (+cfg.mpDelayUs)>0){
      const dS=Math.round((+cfg.mpDelayUs)*1e-6*fs); if(dS>0&&dS<x.length){
        const echo=zeros(x.length), eg=gain*db2lin(+cfg.mpGainDb||-6), ph=(+cfg.mpPhaseDeg||180)*Math.PI/180;
        for(let i=dS;i<x.length;i++) echo[i]=x[i-dS];
        const ez=analytic(echo);
        for(let i=0;i<x.length;i++) y[i]+=eg*(ez.re[i]*Math.cos(ph)-ez.im[i]*Math.sin(ph));
      }
    }
    if(+cfg.clipLevel>0){ const c=+cfg.clipLevel; for(let i=0;i<y.length;i++) y[i]=clamp(y[i],-c,c); }
    const clean=y.slice();
    let noisePow=0;
    if(cfg.snrDb!=null && isFinite(+cfg.snrDb)){
      const pref=rms(x)||1e-12; const pref2=pref*pref; const bw=+cfg.noiseBandwidthHz>0?Math.min(+cfg.noiseBandwidthHz,fs/2):fs/2;
      // SNR nominal en banda bw: ruido total se escala por (fs/2)/bw
      const pnb=pref2/Math.pow(10,(+cfg.snrDb)/10); noisePow=pnb*(fs/2)/Math.max(bw,1e-9);
      const sd=Math.sqrt(Math.max(noisePow,0));
      for(let i=0;i<y.length;i++) y[i]+=randn(rand)*sd;
    } else if(cfg.ebn0Db!=null && isFinite(+cfg.ebn0Db) && +cfg.eb>0){
      const n0=(+cfg.eb)/Math.pow(10,(+cfg.ebn0Db)/10); noisePow=n0*fs/2;
      const sd=Math.sqrt(Math.max(noisePow,0)); for(let i=0;i<y.length;i++) y[i]+=randn(rand)*sd;
    }
    const pClean=rms(clean)**2; const snrEff=noisePow>0?10*Math.log10(Math.max(pClean,1e-30)/noisePow):Infinity;
    const bwEff=+cfg.noiseBandwidthHz>0?Math.min(+cfg.noiseBandwidthHz,fs/2):fs/2;
    const snrBand=noisePow>0?10*Math.log10(Math.max(pClean,1e-30)/noisePow*(fs/2)/Math.max(bwEff,1e-9)):Infinity;
    let ebn0Eff=Infinity;
    if(cfg.ebn0Db!=null && +cfg.eb>0 && noisePow>0){ const n0=noisePow/(fs/2); ebn0Eff=10*Math.log10(Math.max((+cfg.eb)*gain*gain,1e-30)/Math.max(n0,1e-30)); }
    return {y, clean, report:{pathLossDb:pathLoss,totalAttenDb:totalAtten,gain,snrEffDb:snrEff,snrBandDb:snrBand,ebn0EffDb:ebn0Eff}};
  }

  function mse(a,b,trim){ let s=0,n=0,t0=trim|0,t1=a.length-t0; for(let i=t0;i<t1;i++){ const d=a[i]-b[i]; s+=d*d; n++; } return n?s/n:0; }
  function corr(a,b,trim){ let t0=trim|0,t1=a.length-t0,ma=0,mb=0,n=0; for(let i=t0;i<t1;i++){ma+=a[i];mb+=b[i];n++;} if(!n)return 0; ma/=n;mb/=n; let num=0,da=0,db=0; for(let i=t0;i<t1;i++){const aa=a[i]-ma,bb=b[i]-mb;num+=aa*bb;da+=aa*aa;db+=bb*bb;} const den=Math.sqrt(da*db); return den?num/den:0; }

  function simulateAM(c){
    const fs=+c.fs, dur=+c.duration, fm=+c.fm, fc=+c.fc, m=+c.m, Vp=+c.Vp;
    const N=Math.max(256, Math.round(fs*dur)); const t=arange(N,0,1/fs);
    const msg=waveform(c.waveform||'sine', t, {frequency:fm});
    const tx=new Float64Array(N), carrier=new Float64Array(N);
    for(let i=0;i<N;i++){ carrier[i]=Math.sin(TAU*fc*t[i]); tx[i]=Vp*(1+m*msg[i])*carrier[i]; }
    const ch={distanceKm:c.distanceKm||0,freqMhz:(c.channelFreqMhz||fc/1e6),extraAttenDb:c.extraAttenDb||0,snrDb:c.snrDb,noiseBandwidthHz:Math.max(2*fm,1),
      interference:c.interference,intFreqHz:c.intFreqHz,intAmpDb:c.intAmpDb,multipath:c.multipath,mpDelayUs:c.mpDelayUs,mpGainDb:c.mpGainDb,mpPhaseDeg:c.mpPhaseDeg,freqOffsetHz:c.freqOffsetHz,clipLevel:c.clipLevel};
    const {y:rx,report}=applyChannel(tx,fs,ch,c.seed||1);
    // receptor: filtro RF simple + detectores
    const bIf=Math.min(Math.max(2.2*fm,1), Math.max(0.1*fm, 0.48*fs - 2*fc));
    const rxIf=lowpassFFT(rx,fs,fc+bIf/2); // aproximación pasabajos superior; suficiente para demo
    const rxBp=sub(lowpassFFT(rx,fs,Math.min(fs/2-1,fc+bIf/2)), lowpassFFT(rx,fs,Math.max(1,fc-bIf/2)));
    const envRaw=envelope(rxBp.length?rxBp:rxIf);
    const cutoff=Math.min(0.45*fs, Math.max(2.5*fm,50));
    let envLp=lowpassFFT(envRaw,fs,cutoff); const em=mean(envLp);
    const env=new Float64Array(N); const denEnv=m*Vp*report.gain; for(let i=0;i<N;i++) env[i]=denEnv? (envLp[i]-em)/denEnv : envLp[i]-em;
    const cohRaw=new Float64Array(N); for(let i=0;i<N;i++) cohRaw[i]=2*rxBp[i]*Math.sin(TAU*fc*t[i]);
    let cohLp=lowpassFFT(cohRaw,fs,cutoff); const cm=mean(cohLp);
    const coh=new Float64Array(N); const denC=m*Vp*report.gain; for(let i=0;i<N;i++) coh[i]=denC? (cohLp[i]-cm)/denC : cohLp[i]-cm;
    const trim=Math.max(5, Math.min(Math.floor(N/4), Math.round(2*fs/Math.max(fm,1))));
    return {t,msg,tx,rx,env,coh,report,metrics:{m,mseEnv:mse(msg,env,trim),mseCoh:mse(msg,coh,trim),corrEnv:corr(msg,env,trim),corrCoh:corr(msg,coh,trim),
      ptPc:1+0.5*m*m, carrierFrac:1/(1+0.5*m*m), snrEffDb:report.snrBandDb, totalAttenDb:report.totalAttenDb, over:m>1},
      specTx:spectrum(tx,fs), specRx:spectrum(rx,fs)};
  }

  function makeBits(n, mode, manual, seed){
    n=Math.max(1,n|0); const b=new Uint8Array(n);
    if(mode==='manual'){ const s=(manual||'10110').replace(/[^01]/g,'')||'10'; for(let i=0;i<n;i++) b[i]=s.charCodeAt(i%s.length)-48; }
    else if(mode==='alternating'){ for(let i=0;i<n;i++) b[i]=i&1; }
    else { const r=rng(seed||1); for(let i=0;i<n;i++) b[i]=r()<0.5?0:1; }
    return b;
  }
  function snapCarrier(fc, rb, fs){ let maxC=Math.max(1,Math.floor((0.5*fs-1e-9)/rb)); let c=Math.round(fc/rb); c=clamp(c,1,maxC); return {fc:c*rb, cycles:c}; }

  function simulateDigital(c){
    const scheme=(c.scheme||'ASK').toUpperCase(), nbits=Math.max(8,+c.nbits|0), rb=+c.rb, sps=Math.max(8,+c.sps|0), A=+c.amplitude||1;
    const fs=rb*sps, tb=1/rb, N=nbits*sps, t=arange(N,0,1/fs), bits=makeBits(nbits,c.bitMode,c.manualBits,c.seed||1);
    const tx=new Float64Array(N); let eb=0, fc0=+c.fc, cycles=0, extras={};
    if(scheme==='FSK'){
      const h=+c.h||1, df=0.5*h*rb, f0=Math.max(1,fc0-df), f1=fc0+df; extras={f0,f1,df,h,bandwidthHz:2*(df+rb)};
      for(let k=0;k<nbits;k++){ const f=bits[k]?f1:f0; for(let i=0;i<sps;i++){ const n=k*sps+i; tx[n]=A*Math.cos(TAU*f*(i/fs)); } }
      eb=A*A*tb/2;
    } else {
      const sn=snapCarrier(fc0,rb,fs); fc0=sn.fc; cycles=sn.cycles;
      for(let n=0;n<N;n++) tx[n]=A*Math.cos(TAU*fc0*t[n]);
      if(scheme==='BPSK'){ for(let k=0;k<nbits;k++){ const v=bits[k]?1:-1; for(let i=0;i<sps;i++) tx[k*sps+i]*=v; } eb=A*A*tb/2; }
      else { for(let k=0;k<nbits;k++){ const v=bits[k]?1:0; for(let i=0;i<sps;i++) tx[k*sps+i]*=v; } eb=A*A*tb/4; extras.detector=c.detector||'coherent'; }
      extras.fc=fc0; extras.cyclesPerBit=cycles; extras.bandwidthHz=2*rb;
    }
    const ch={distanceKm:c.distanceKm||0,freqMhz:(c.channelFreqMhz||fc0/1e6),extraAttenDb:c.extraAttenDb||0,ebn0Db:c.ebn0Db,eb,
      interference:c.interference,intFreqHz:c.intFreqHz,intAmpDb:c.intAmpDb,multipath:c.multipath,mpDelayUs:c.mpDelayUs,mpGainDb:c.mpGainDb,mpPhaseDeg:c.mpPhaseDeg,freqOffsetHz:c.freqOffsetHz,clipLevel:c.clipLevel};
    const {y:rx,report}=applyChannel(tx,fs,ch,(c.seed||1)+11);
    const det=new Uint8Array(nbits);
    if(scheme==='FSK'){
      const h=+c.h||1, df=0.5*h*rb, f0=Math.max(1,(+c.fc)-df), f1=(+c.fc)+df;
      const coherent=(c.detector||'').toLowerCase().indexOf('coh')===0;
      for(let k=0;k<nbits;k++){ let e0=0,e1=0,i0=0,i1=0; for(let i=0;i<sps;i++){ const n=k*sps+i, tt=i/fs; const c0=Math.cos(TAU*f0*tt),s0=Math.sin(TAU*f0*tt),c1=Math.cos(TAU*f1*tt),s1=Math.sin(TAU*f1*tt);
        if(coherent){ e0+=rx[n]*c0; e1+=rx[n]*c1; } else { i0+=rx[n]*c0; e0+=rx[n]*s0; i1+=rx[n]*c1; e1+=rx[n]*s1; } }
        det[k]=(coherent?(e1>e0):(i1*i1+e1*e1 > i0*i0+e0*e0))?1:0; }
    } else {
      for(let k=0;k<nbits;k++){ let acc=0; for(let i=0;i<sps;i++){ const n=k*sps+i; acc+=rx[n]*A*Math.cos(TAU*fc0*t[n]); } acc/=fs;
        if(scheme==='BPSK') det[k]=acc>0?1:0; else { const e1=A*A*tb/2; det[k]=acc>0.5*e1*report.gain?1:0; } }
    }
    let errors=0; for(let i=0;i<nbits;i++) if(det[i]!==bits[i]) errors++;
    const rbw=extras.bandwidthHz||2*rb; const snrBand = report.ebn0EffDb!=null && isFinite(report.ebn0EffDb) ? report.ebn0EffDb + 10*Math.log10(rb/rbw) : report.snrBandDb;
    return {t,bits,det,tx,rx,report,errors,ber:errors/nbits,nbits,rb,fs,fc:fc0,extras:{...extras,snrBandDb:snrBand},specTx:spectrum(tx,fs)};
  }

  function quantizeUniform(x, nBits, fullScale){
    const L=1<<nBits, q=2*fullScale/L, xq=new Float64Array(x.length), err=new Float64Array(x.length), idx=new Int32Array(x.length);
    for(let i=0;i<x.length;i++){ let k=Math.floor((x[i]+fullScale)/q); k=clamp(k,0,L-1); idx[i]=k; xq[i]=-fullScale+(k+0.5)*q; err[i]=xq[i]-x[i]; }
    return {xq,err,q,idx,levels:L};
  }
  function reconstructZOH(ts,xq,tOut){ return interp1(ts,xq,tOut); } // paso simple; visual
  function reconstructFFT(ts, xq, tOut, fsAnalog){
    // Reconstrucción por FFT: asume rejilla uniforme alineada (caso demo)
    const n=xq.length; const dt=ts.length>1?ts[1]-ts[0]:1; const fsS=1/dt; const nOut=tOut.length;
    const up=Math.max(1, Math.round(fsAnalog/fsS));
    const re=new Float64Array(nextPow2(n)); re.set(xq); const im=new Float64Array(re.length); fft(re,im,false);
    const nUp=n*up; const outN=nextPow2(nUp); const ore=new Float64Array(outN), oim=new Float64Array(outN);
    const half=n>>1; for(let i=0;i<=half && i<re.length;i++){ ore[i]=re[i]; oim[i]=im[i]; }
    if(n%2===0 && half<ore.length){ ore[half]*=0.5; oim[half]*=0.5; }
    fft(ore,oim,true); const yup=new Float64Array(nUp); for(let i=0;i<nUp;i++) yup[i]=ore[i]*up;
    const tUp=arange(nUp, ts[0], dt/up); return interp1(tUp, yup, tOut);
  }

  function simulatePCM(c){
    const fm=+c.fm, fsS=+c.fsSample, nBits=+c.nBits|0, dur=+c.duration, A=+c.amplitude||0.8, FS=+c.fullScale||1;
    const fsA=Math.min(Math.max(40*fm,12*fsS,48000),240000); const Na=Math.max(256,Math.round(fsA*dur)), Ns=Math.max(8,Math.round(fsS*dur));
    const tA=arange(Na,0,1/fsA), tS=arange(Ns,0,1/fsS);
    let xA=waveform(c.waveform||'sine', tA, {frequency:fm}); for(let i=0;i<Na;i++) xA[i]*=A;
    let xAf=xA; if(c.antialias!==false) xAf=lowpassFFT(xA,fsA,0.45*fsS);
    const xS=interp1(tA,xAf,tS);
    const q=quantizeUniform(xS,nBits,FS);
    // codificar bits (para BER)
    const rb=fsS*nBits, sps=Math.max(8,+c.sps||16), fsR=rb*sps;
    const bits=new Uint8Array(Ns*nBits); for(let i=0;i<Ns;i++){ for(let b=0;b<nBits;b++) bits[i*nBits+b]=(q.idx[i]>>(nBits-1-b))&1; }
    const dig=simulateDigital({scheme:c.scheme||'BPSK', nbits:bits.length, rb, fc:+c.fc||Math.min(20000,fsR/4), amplitude:1, sps, detector:c.detector||'coherent', seed:c.seed||1,
      distanceKm:c.distanceKm||0, channelFreqMhz:c.channelFreqMhz||0, extraAttenDb:c.extraAttenDb||0, ebn0Db:c.ebn0Db, interference:c.interference,intFreqHz:c.intFreqHz,intAmpDb:c.intAmpDb,multipath:c.multipath,mpDelayUs:c.mpDelayUs,mpGainDb:c.mpGainDb,mpPhaseDeg:c.mpPhaseDeg,freqOffsetHz:c.freqOffsetHz,clipLevel:c.clipLevel, bitMode:'manual', manualBits:Array.from(bits).join('')});
    // decodificar
    const idxRx=new Int32Array(Ns); for(let i=0;i<Ns;i++){ let v=0; for(let b=0;b<nBits;b++) v=(v<<1)|(dig.det[i*nBits+b]&1); idxRx[i]=v; }
    const L=1<<nBits, stepQ=2*FS/L, xqRx=new Float64Array(Ns); for(let i=0;i<Ns;i++) xqRx[i]=-FS+(idxRx[i]+0.5)*stepQ;
    const xZOH=reconstructZOH(tS,xqRx,tA); const xRec=reconstructFFT(tS,xqRx,tA,fsA);
    const trim=Math.max(8,Math.min(Math.floor(Na/4), Math.round(0.004*fsA)));
    const sqnrRef=rms(sliceArr(xA,trim,Na-trim))**2; const sqnrErr=rms(sub(sliceArr(xA,trim,Na-trim),sliceArr(xRec,trim,Na-trim)))**2;
    const sqnr=sqnrErr>0?10*Math.log10(Math.max(sqnrRef,1e-30)/sqnrErr):Infinity;
    const sqnrQ=10*Math.log10(Math.max(rms(xS)**2,1e-30)/Math.max(rms(q.err)**2,1e-30));
    const sqnrTh=6.02*nBits+1.76+20*Math.log10(Math.max(A,1e-9)/Math.max(FS,1e-9));
    return {tA,xA,tS,xS,xq:q.xq,xRec,xZOH,qerr:q.err,q:stepQ,ber:dig.ber,errors:dig.errors,nbitsTotal:bits.length,rb,sqnr,sqnrQ,sqnrTh,report:dig.report,alias:fm>0.5*fsS*1.02,nyquist:0.5*fsS,specA:spectrum(xA,fsA),specS:spectrum(xS,fsS)};
  }

  global.Sim = {TAU,waveform,applyChannel,fslDb,simulateAM,simulateDigital,simulatePCM,makeBits,spectrum,db2lin,mean,rms};
})(window);
