(function(root){
"use strict";

const ENGINE_VERSION="omr-js-v6-cantos-qr";
const LETTERS=["A","B","C","D","E"];

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function mean(values){return values.length?values.reduce((s,v)=>s+v,0)/values.length:0}
function median(values){
  if(!values.length)return 0;
  const a=values.slice().sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function luminance(r,g,b){return .299*r+.587*g+.114*b}

function resizeNearest(image,maxDimension){
  const scale=Math.min(1,maxDimension/Math.max(image.width,image.height));
  if(scale===1)return{image,scaleX:1,scaleY:1};
  const width=Math.max(1,Math.round(image.width*scale));
  const height=Math.max(1,Math.round(image.height*scale));
  const out=new Uint8ClampedArray(width*height*4),src=image.data;
  for(let y=0;y<height;y++){
    const sy=Math.min(image.height-1,Math.floor(y/scale));
    for(let x=0;x<width;x++){
      const sx=Math.min(image.width-1,Math.floor(x/scale));
      const si=(sy*image.width+sx)*4,di=(y*width+x)*4;
      out[di]=src[si];out[di+1]=src[si+1];out[di+2]=src[si+2];out[di+3]=255;
    }
  }
  return{image:{data:out,width,height},scaleX:image.width/width,scaleY:image.height/height};
}

function grayscaleAndHistogram(image){
  const total=image.width*image.height,gray=new Uint8Array(total),hist=new Uint32Array(256),d=image.data;
  for(let i=0;i<total;i++){
    const k=i*4,v=Math.round(luminance(d[k],d[k+1],d[k+2]));
    gray[i]=v;hist[v]++;
  }
  return{gray,hist};
}

function otsuThreshold(hist,total){
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let sumBackground=0,weightBackground=0,best=0,maxVariance=-1;
  for(let t=0;t<256;t++){
    weightBackground+=hist[t];if(!weightBackground)continue;
    const weightForeground=total-weightBackground;if(!weightForeground)break;
    sumBackground+=t*hist[t];
    const meanBackground=sumBackground/weightBackground;
    const meanForeground=(sum-sumBackground)/weightForeground;
    const variance=weightBackground*weightForeground*(meanBackground-meanForeground)*(meanBackground-meanForeground);
    if(variance>maxVariance){maxVariance=variance;best=t}
  }
  return clamp(best,65,195);
}

function squareCandidates(image){
  const {width:w,height:h}=image,total=w*h,{gray,hist}=grayscaleAndHistogram(image);
  const threshold=otsuThreshold(hist,total),mask=new Uint8Array(total),queue=new Int32Array(total);
  for(let i=0;i<total;i++)if(gray[i]<threshold)mask[i]=1;
  const minDim=Math.min(w,h),minSize=Math.max(9,minDim*.018),maxSize=minDim*.22,candidates=[];
  for(let start=0;start<total;start++){
    if(!mask[start])continue;
    let head=0,tail=0,area=0,minX=w,maxX=0,minY=h,maxY=0;
    queue[tail++]=start;mask[start]=0;
    while(head<tail){
      const p=queue[head++],y=Math.floor(p/w),x=p-y*w;area++;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      const y0=Math.max(0,y-1),y1=Math.min(h-1,y+1),x0=Math.max(0,x-1),x1=Math.min(w-1,x+1);
      for(let ny=y0;ny<=y1;ny++)for(let nx=x0;nx<=x1;nx++){
        const np=ny*w+nx;if(mask[np]){mask[np]=0;queue[tail++]=np}
      }
    }
    const bw=maxX-minX+1,bh=maxY-minY+1,boxArea=bw*bh,aspect=bw/bh,fill=area/boxArea;
    if(bw>=minSize&&bh>=minSize&&bw<=maxSize&&bh<=maxSize&&aspect>.45&&aspect<2.20&&fill>.45){
      candidates.push({x:(minX+maxX)/2,y:(minY+maxY)/2,area,bw,bh,fill,minX,maxX,minY,maxY,touchesEdge:minX<=1||minY<=1||maxX>=w-2||maxY>=h-2});
    }
  }
  candidates.sort((a,b)=>b.area-a.area);
  /* Área de referência = maior grupo de 3+ quadrados de tamanho parecido (os
     marcadores dos cantos). Antes usava-se simplesmente o maior componente, mas o
     QR code, quando os módulos se fundem na foto, vira um bloco maior que os
     marcadores e eliminava os quatro cantos reais do filtro relativo. */
  let largest=candidates[0]?.area||0;
  for(const c of candidates){
    const similar=candidates.reduce((n,o)=>n+(o!==c&&o.area>=c.area*.55&&o.area<=c.area*1.8?1:0),0);
    if(similar>=2){largest=c.area;break}
  }
  const kept=candidates.filter(c=>!largest||(c.area>=largest*.32&&!(c.fill<.6&&c.area>largest*1.6)));
  return{candidates:kept.slice(0,18),threshold};
}

/* Reserva para fotos pequenas/comprimidas: procura núcleos quadrados densos.
   Diferente dos componentes conectados, continua encontrando o marcador quando
   ele encosta visualmente na borda do cartão. */
function denseSquareCandidates(image,threshold){
  const w=image.width,h=image.height,d=image.data,strideW=w+1,integral=new Uint32Array((w+1)*(h+1));
  for(let y=1;y<=h;y++){
    let row=0;
    for(let x=1;x<=w;x++){
      const k=((y-1)*w+x-1)*4;
      row+=Math.round(luminance(d[k],d[k+1],d[k+2]));
      integral[y*strideW+x]=integral[(y-1)*strideW+x]+row;
    }
  }
  const sumBounds=(x0,y0,x1,y1)=>integral[y1*strideW+x1]-integral[y0*strideW+x1]-integral[y1*strideW+x0]+integral[y0*strideW+x0];
  const minDim=Math.min(w,h),sizes=[.026,.038,.052,.068,.086].map(v=>Math.max(8,Math.round(minDim*v))).filter((v,i,a)=>a.indexOf(v)===i),raw=[];
  for(const size of sizes){
    const step=Math.max(2,Math.floor(size/4));
    for(let y=0;y<=h-size;y+=step)for(let x=0;x<=w-size;x+=step){
      const pad=Math.max(3,Math.round(size*.70));
      /* Um marcador válido precisa caber inteiro, inclusive seu entorno. Isso
         também impede que uma faixa escura na borda da foto vire um canto. */
      if(x<pad||y<pad||x+size+pad>w||y+size+pad>h)continue;
      const outerX0=x-pad,outerY0=y-pad,outerX1=x+size+pad,outerY1=y+size+pad;
      const innerArea=size*size,innerTotal=sumBounds(x,y,x+size,y+size),innerMean=innerTotal/innerArea;
      const outerArea=(outerX1-outerX0)*(outerY1-outerY0),ringArea=outerArea-size*size;
      if(ringArea<=0)continue;
      const ringMean=(sumBounds(outerX0,outerY0,outerX1,outerY1)-innerTotal)/ringArea,contrast=ringMean-innerMean;
      /* Um marcador tem núcleo preto e entorno claro. Regiões grandes e escuras
         da foto podem ser pretas no limiar global, mas não têm contraste local. */
      if(contrast<34||innerMean>145)continue;
      const fill=clamp(contrast/115,0,1);
      raw.push({x:x+(size-1)/2,y:y+(size-1)/2,area:size*size,bw:size,bh:size,fill,minX:x,maxX:x+size-1,minY:y,maxY:y+size-1,touchesEdge:false,scanScore:contrast/115+(255-innerMean)/255*.18+size/minDim*.30});
    }
  }
  raw.sort((a,b)=>b.scanScore-a.scanScore);
  const kept=[];
  for(const c of raw){
    if(kept.some(k=>distance(c,k)<Math.max(c.bw,k.bw)*.90))continue;
    kept.push(c);if(kept.length>=48)break;
  }
  return kept;
}

function orderClockwise(points){
  const cx=mean(points.map(p=>p.x)),cy=mean(points.map(p=>p.y));
  return points.slice().sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
}
function cross(a,b,c){return(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function polygonArea(points){
  let s=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];s+=a.x*b.y-b.x*a.y}
  return Math.abs(s)/2;
}
function convexQuad(points){
  let sign=0;
  for(let i=0;i<4;i++){
    const c=cross(points[i],points[(i+1)%4],points[(i+2)%4]);
    if(Math.abs(c)<1e-3)return false;
    const next=Math.sign(c);if(sign&&next!==sign)return false;sign=next;
  }
  return true;
}

function chooseMarkerQuad(candidates,width,height){
  if(candidates.length<4)return null;
  let best=null,bestScore=-Infinity;
  for(let a=0;a<candidates.length-3;a++)for(let b=a+1;b<candidates.length-2;b++)for(let c=b+1;c<candidates.length-1;c++)for(let d=c+1;d<candidates.length;d++){
    const selected=[candidates[a],candidates[b],candidates[c],candidates[d]],ordered=orderClockwise(selected);
    if(!convexQuad(ordered))continue;
    const area=polygonArea(ordered),areaRatio=area/(width*height);if(areaRatio<.055)continue;
    const sides=ordered.map((p,i)=>distance(p,ordered[(i+1)%4]));
    if(Math.min(...sides)<Math.min(width,height)*.12)continue;
    const sizes=selected.map(p=>Math.sqrt(p.area)),sizeConsistency=Math.min(...sizes)/Math.max(...sizes);
    if(sizeConsistency<.50)continue;
    const fill=mean(selected.map(p=>p.fill));
    const score=areaRatio*5+sizeConsistency*.8+fill*.25;
    if(score>bestScore){bestScore=score;best={points:ordered,items:ordered,areaRatio,score}}
  }
  return best;
}

function detectCornerMarkers(image){
  const resized=resizeNearest(image,1100),found=squareCandidates(resized.image);
  const componentQuad=chooseMarkerQuad(found.candidates,resized.image.width,resized.image.height);
  /* O caminho denso só é acionado quando os componentes conectados falham.
     Assim, cartões já reconhecidos mantêm exatamente o comportamento anterior. */
  const denseCandidates=componentQuad?[]:denseSquareCandidates(resized.image,found.threshold);
  const denseQuad=componentQuad?null:chooseMarkerQuad(denseCandidates,resized.image.width,resized.image.height);
  /* Quatro bolhas preenchidas também podem formar um quadrilátero pequeno.
     Os marcadores reais ocupam a parte externa do cartão. */
  const quad=componentQuad||(denseQuad?.areaRatio>=.16?denseQuad:null);
  if(!quad){
    const count=found.candidates.length,maxArea=found.candidates[0]?.area||0;
    const dominant=maxArea?found.candidates.filter(c=>c.area>=maxArea*.45).length:0;
    return{ok:false,reason:dominant>0&&dominant<4?"card-cropped":"corners-not-found",candidateCount:count,denseCandidateCount:denseCandidates.length,dominantCount:dominant,threshold:found.threshold};
  }
  if(quad.items.some(p=>p.touchesEdge))return{ok:false,reason:"card-cropped",candidateCount:found.candidates.length};
  const points=quad.points.map(p=>({x:p.x*resized.scaleX,y:p.y*resized.scaleY}));
  return{ok:true,points,candidateCount:found.candidates.length,denseCandidateCount:denseCandidates.length,areaRatio:quad.areaRatio,threshold:found.threshold};
}

function solveHomography(from,to){
  const matrix=[];
  for(let i=0;i<4;i++){
    const x=from[i].x,y=from[i].y,u=to[i].x,v=to[i].y;
    matrix.push([x,y,1,0,0,0,-u*x,-u*y,u]);
    matrix.push([0,0,0,x,y,1,-v*x,-v*y,v]);
  }
  for(let col=0;col<8;col++){
    let pivot=col;
    for(let row=col+1;row<8;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
    if(Math.abs(matrix[pivot][col])<1e-10)return null;
    if(pivot!==col){const temp=matrix[pivot];matrix[pivot]=matrix[col];matrix[col]=temp}
    const div=matrix[col][col];for(let j=col;j<9;j++)matrix[col][j]/=div;
    for(let row=0;row<8;row++)if(row!==col){const factor=matrix[row][col];if(!factor)continue;for(let j=col;j<9;j++)matrix[row][j]-=factor*matrix[col][j]}
  }
  return matrix.map(row=>row[8]).concat(1);
}

function warpPerspective(image,sourceQuad,geometry){
  const width=geometry.w||1000,height=geometry.h;
  const canonical=[{x:95,y:95},{x:width-95,y:95},{x:width-95,y:height-95},{x:95,y:height-95}];
  const h=solveHomography(canonical,sourceQuad);if(!h)return null;
  const out=new Uint8ClampedArray(width*height*4),src=image.data,sw=image.width,sh=image.height;
  out.fill(255);
  for(let y=0;y<height;y++){
    const n0=h[1]*y+h[2],n1=h[4]*y+h[5],d0=h[7]*y+h[8];
    for(let x=0;x<width;x++){
      const den=h[6]*x+d0;if(Math.abs(den)<1e-8)continue;
      const sx=Math.round((h[0]*x+n0)/den),sy=Math.round((h[3]*x+n1)/den);
      if(sx<0||sy<0||sx>=sw||sy>=sh)continue;
      const si=(sy*sw+sx)*4,di=(y*width+x)*4;
      out[di]=src[si];out[di+1]=src[si+1];out[di+2]=src[si+2];out[di+3]=255;
    }
  }
  return{data:out,width,height,homography:h};
}

function questionXs(geometry,questionIndex){
  return geometry.questionXs?.[questionIndex]||geometry.xs;
}

function ringInkRatio(image,cx,cy){
  const d=image.data,w=image.width,h=image.height;let ink=0,n=0;
  for(let y=Math.max(0,Math.floor(cy-39));y<=Math.min(h-1,Math.ceil(cy+39));y++)for(let x=Math.max(0,Math.floor(cx-39));x<=Math.min(w-1,Math.ceil(cx+39));x++){
    const dx=x-cx,dy=y-cy,r2=dx*dx+dy*dy;if(r2<28*28||r2>38*38)continue;
    const k=(y*w+x)*4;n++;if(luminance(d[k],d[k+1],d[k+2])<185)ink++;
  }
  return n?ink/n:0;
}

function gridAlignment(image,test,geometry){
  const ratios=[];
  for(let q=0;q<test.questionCount;q++)for(const x of questionXs(geometry,q))ratios.push(ringInkRatio(image,x,geometry.ys[q]));
  const valid=ratios.filter(v=>v>.13).length/(ratios.length||1),med=median(ratios),score=med*.65+valid*.35;
  return{score,medianRing:med,validRatio:valid,ratios};
}

function bubbleStats(image,cx,cy){
  const d=image.data,w=image.width,h=image.height;let n=0,dark=0,blue=0,sum=0,rn=0,ringSum=0;
  const inner=20,outer1=40,outer2=50;
  for(let y=Math.max(0,Math.floor(cy-outer2));y<=Math.min(h-1,Math.ceil(cy+outer2));y++)for(let x=Math.max(0,Math.floor(cx-outer2));x<=Math.min(w-1,Math.ceil(cx+outer2));x++){
    const dx=x-cx,dy=y-cy,r2=dx*dx+dy*dy,k=(y*w+x)*4,R=d[k],G=d[k+1],B=d[k+2],Y=luminance(R,G,B);
    if(r2<=inner*inner){
      n++;sum+=Y;if(Y<178)dark++;
      const max=Math.max(R,G,B),min=Math.min(R,G,B),sat=max?(max-min)/max:0;
      if(B>R*1.08&&B>G*.88&&sat>.18&&R<210)blue++;
    }else if(r2>=outer1*outer1&&r2<=outer2*outer2){rn++;ringSum+=Y}
  }
  const average=n?sum/n:255,surround=rn?ringSum/rn:255,darkRatio=n?dark/n:0,blueRatio=n?blue/n:0,contrast=Math.max(0,surround-average)/100;
  return{score:.75*darkRatio+1.45*blueRatio+.85*contrast,darkRatio,blueRatio,average,surround};
}

function detectAnswers(image,test,geometry){
  const letters=LETTERS.slice(0,test.optionCount),answers=[],flags=[],detail=[];
  for(let q=0;q<test.questionCount;q++){
    const stats=questionXs(geometry,q).map(x=>bubbleStats(image,x,geometry.ys[q]));
    const ranked=stats.map((s,i)=>({i,value:s.score})).sort((a,b)=>b.value-a.value),best=ranked[0],second=ranked[1],gap=best.value-second.value;
    let answer="",status="blank",candidates=[];
    const doubleMarked=best.value>.30&&second.value>.25&&gap<.20;
    if(doubleMarked){
      status="double";candidates=ranked.filter(v=>v.value>.24&&best.value-v.value<.22).map(v=>letters[v.i]);
    }else if(best.value>.36&&gap>.105){
      answer=letters[best.i];status="ok";candidates=[answer];
    }else if(best.value>.18){
      answer=letters[best.i];status="weak";candidates=[answer];
    }
    answers.push(answer);
    flags.push({status,candidates,confirmed:status==="ok"||status==="blank",wasDoubtful:status==="weak"||status==="double"});
    detail.push({q:q+1,scores:stats.map(s=>+s.score.toFixed(3)),gap:+gap.toFixed(3),status,candidates});
  }
  return{answers,flags,detail};
}

function orientationStarts(points,qrCenter){
  const starts=[0,1,2,3];if(!qrCenter)return starts;
  let nearest=0,best=Infinity;
  points.forEach((p,i)=>{const d=distance(p,qrCenter);if(d<best){best=d;nearest=i}});
  const preferred=(nearest+3)%4;
  return[preferred,...starts.filter(v=>v!==preferred)];
}

function readCardImageData(image,test,geometry,qrCenter){
  const markers=detectCornerMarkers(image);
  if(!markers.ok)return{ok:false,error:markers.reason,markerInfo:markers};
  const ordered=orderClockwise(markers.points),starts=orientationStarts(ordered,qrCenter);let best=null;
  for(let index=0;index<starts.length;index++){
    const k=starts[index],quad=[ordered[k],ordered[(k+1)%4],ordered[(k+2)%4],ordered[(k+3)%4]];
    const warped=warpPerspective(image,quad,geometry);if(!warped)continue;
    const alignment=gridAlignment(warped,test,geometry),candidate={warped,alignment,rotation:k*90,sourceQuad:quad};
    if(!best||alignment.score>best.alignment.score)best=candidate;
    if(index===0&&alignment.score>.34&&alignment.validRatio>.72)break;
  }
  if(!best||best.alignment.score<.16||best.alignment.validRatio<.45){
    return{ok:false,error:"grid-misaligned",markerInfo:markers,alignment:best?.alignment||null,warped:best?.warped||null};
  }
  const read=detectAnswers(best.warped,test,geometry);
  return{ok:true,answers:read.answers,flags:read.flags,detail:read.detail,warped:best.warped,alignment:best.alignment,rotation:best.rotation,markerInfo:markers,reader:"omr-js"};
}

function readCard(canvas,test,geometry,qrCenter){
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  return readCardImageData(image,test,geometry,qrCenter);
}

const api={ENGINE_VERSION,readCard,readCardImageData,detectCornerMarkers,solveHomography,warpPerspective,gridAlignment,detectAnswers,orderClockwise};
root.OMREngine=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
