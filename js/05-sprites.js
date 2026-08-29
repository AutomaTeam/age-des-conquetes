'use strict';
// ======================================================================
//  05-sprites.js
// ======================================================================
// Atlas de sprites pixel art, icones d'interface, surcouche des
// illustrations et teintes de faction. Tout est pre-rendu hors ecran.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── CANVAS ────────────────────────────────────────────────
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
const mm=document.getElementById('mm');
const mctx=mm.getContext('2d');
let W=0, H=0;

function resizeCanvas(){
  W=window.innerWidth; H=window.innerHeight;
  canvas.width=W*DPR; canvas.height=H*DPR;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
}

function gameH(){ return H-54-(document.getElementById('botpanel').offsetHeight||130); }

// ═══════════════════════════════════════════════════════════
//  ATLAS DE SPRITES PIXEL ART (pré-rendu, perf 60fps)
//  Tout est dessiné UNE fois sur des canvas hors-écran,
//  puis copié via drawImage à chaque frame (quasi gratuit).
// ═══════════════════════════════════════════════════════════
// `let` et non `const` : la régénération étalée (voir avancerAtlas) construit
// un atlas BROUILLON à côté puis le substitue d'un seul coup — un échange de
// référence est la seule bascule qu'une image de rendu ne peut pas surprendre
// à moitié faite. Rien d'autre dans le fichier ne réaffecte SPR.
let SPR={ terrain:{}, tree:[], stone:[], gold:[], berry:[], bld:{}, bldCiv:{}, unit:{} };
const PIXEL=4; // résolution interne du pixel art (px logiques par "gros pixel")
const SS=3;    // supersampling : sprites générés en 3×, dessinés réduits (lissés) => rendu fin

// ── RÉSOLUTIONS DE TRAVAIL DU DÉTOURAGE ────────────────────────
// Les planches illustrées font 832×1248. Le détourage (voir stripBgTrimmed)
// n'a aucune raison de travailler à cette taille : le plus gros sprite jamais
// AFFICHÉ est un bâtiment au zoom maximum (~490 px de large), une unité
// plafonne à ~170 px et un gisement à ~295 px. Travailler à la résolution
// réellement utile divise d'autant le coût du flood fill ET la mémoire du
// cache, sans aucune perte visible à l'écran.
// Extension des planches illustrees. Point de passage UNIQUE : elle etait
// ecrite en dur a quinze endroits, ce qui rendait tout changement de format
// impossible a faire sans en oublier un — et un oubli est SILENCIEUX (le
// fichier manquant fait simplement retomber sur le sprite procedural, voir
// withIllustration/onerror), donc invisible jusqu'a ce qu'on remarque qu'un
// batiment a perdu son illustration.
const ASSET_EXT='.webp';
const TRIM_W_BLD=512, TRIM_W_UNIT=320, TRIM_W_NODE=320, TRIM_W_ICON=256;
const GRASS_VARIANTS=8; // nb de textures d'herbe distinctes (buildTerrain ↔ drawMap doivent s'accorder)
const WATER_VARIANTS=6; // idem pour l'eau (buildTerrain ↔ drawMap)

// Crée un canvas hors-écran
function offCanvas(w,h){
  const c=document.createElement('canvas');
  c.width=w; c.height=h;
  const cx=c.getContext('2d');
  cx.imageSmoothingEnabled=false;
  return {c,cx};
}

// Dessine un "gros pixel" (carré net) — la base du pixel art
function px(cx,x,y,w,h,col){ cx.fillStyle=col; cx.fillRect(x|0,y|0,w|0,h|0); }

// Petit générateur pseudo-aléatoire déterministe (pour textures stables)
function srnd(seed){ let s=seed%2147483647; if(s<=0)s+=2147483646; return ()=>(s=s*16807%2147483647)/2147483647; }

// ── TERRAIN ───────────────────────────────────────────────
// Passe « haut de gamme » : ombres/lumières en blobs organiques (pas une
// grille de carrés), lumière directionnelle globale cohérente avec le
// biseau des bâtiments (clair haut-gauche → sombre bas-droite), grain fin
// et une décoration signature par variante — 8 textures d'herbe distinctes
// au lieu de 6, pour casser la répétition sur une grande carte.
// `partie` découpe la génération pour la reconstruction étalée (voir
// etapesAtlas) : 1 = herbe et sable, 2 = eau, absent = tout d'un bloc, pour
// le démarrage de partie où l'on a besoin de l'atlas complet immédiatement.
// C'est de loin la plus grosse étape (57 canevas, ~33 ms au zoom maximum) :
// la scinder en deux suffit à la faire tenir dans une image.
function buildTerrain(T,partie){
  if(partie===2) return buildTerrainEau(T);
  // Base QUASI UNIE d'une variante à l'autre (±2 sur chaque composante) :
  // l'ancienne palette s'étalait de #4a7a33 à #609140, soit ~20 % d'écart de
  // luminosité — assez pour que chaque tuile se lise comme un carré distinct
  // et que la carte entière apparaisse en damier. La variété doit venir des
  // DÉTAILS (touffes, fleurs, galets), jamais du fond : lui doit être
  // invisible d'une case à l'autre.
  const grassBase=['#54832f','#568530','#538130','#55842e','#568331','#54822f','#558430','#538230'];
  for(let v=0;v<GRASS_VARIANTS;v++){
    const{c,cx}=offCanvas(T,T);
    const rnd=srnd(v*97+13);
    px(cx,0,0,T,T,grassBase[v]);

    // Touffes organiques (ombre/lumière) en ellipses douces plutôt qu'en
    // carrés alignés sur une grille : une fois le sprite réduit avec
    // lissage, ça se lit comme des zones naturelles, pas un damier.
    // Touffes plus nombreuses mais BEAUCOUP plus discrètes : une grosse tache
    // à 20 % d'opacité tenant sur une seule case se lit comme « cette tuile-là
    // est plus sombre » ; dix taches à 8 % se lisent comme du relief.
    const nBlobs=11+((rnd()*5)|0);
    for(let i=0;i<nBlobs;i++){
      const bx=rnd()*T, by=rnd()*T, br=T*(0.07+rnd()*0.11);
      cx.beginPath(); cx.ellipse(bx,by,br,br*0.72,rnd()*Math.PI,0,Math.PI*2);
      cx.fillStyle=rnd()<0.55?'rgba(35,62,22,.09)':'rgba(150,195,105,.08)';
      cx.fill();
    }

    // Brins d'herbe en 3 tons (base → tige → pointe éclairée), légèrement
    // penchés — plus de relief qu'un brin plat à deux couleurs.
    for(let i=0;i<9;i++){
      const gx=(rnd()*(T-8)|0)+4, gy=(rnd()*(T-12)|0)+8, lean=1+((rnd()*2)|0);
      px(cx,gx,gy-2,2,4,'#33581f');
      px(cx,gx+lean,gy-6,2,5,'#437029');
      px(cx,gx+lean*2,gy-9,2,4,'#5e9438');
    }

    // Grain fin (dithering pixel-art classique, casse les aplats)
    for(let i=0;i<14;i++){
      const dx=(rnd()*T)|0, dy=(rnd()*T)|0;
      cx.fillStyle=rnd()<0.5?'rgba(0,0,0,.10)':'rgba(255,255,255,.08)';
      cx.fillRect(dx,dy,1,1);
    }

    // Détail signature — un par variante (fleur, galets, trèfle, champignon,
    // brindille, marguerite, feuilles mortes, pousse claire) : avec 8
    // variantes bien différenciées, aucune tuile ne ressemble vraiment à sa
    // voisine même sur une grande carte.
    // Une variante sur deux seulement porte son détail : avec un détail par
    // tuile, le tapis d'herbe se couvrait de confettis colorés (fleurs,
    // trèfles, champignons) dès qu'on zoomait. Les variantes impaires restent
    // de l'herbe nue et servent de respiration entre les autres.
    const dx=(rnd()*(T-12)|0)+6, dy=(rnd()*(T-12)|0)+6;
    // …et parmi les huit décors dessinés plus bas, on ne garde que les quatre
    // discrets (fleur jaune, galets, marguerite, brindille) : trèfle mauve,
    // champignon rouge et feuilles mortes tranchaient trop sur le vert.
    if(v%2===0) switch([0,1,5,4][v>>1]){
      case 0: // fleur jaune
        px(cx,dx,dy,1,3,'#3a6024');
        cx.fillStyle='#f0d55a'; cx.beginPath(); cx.arc(dx,dy-2,2.6,0,Math.PI*2); cx.fill();
        cx.fillStyle='#8a6a1a'; cx.beginPath(); cx.arc(dx,dy-2,1,0,Math.PI*2); cx.fill();
        break;
      case 1: // galets
        px(cx,dx,dy,4,3,'#8a8a86'); px(cx,dx,dy,2,2,'#a8a8a2');
        px(cx,dx+5,dy+3,3,2,'#77776f');
        break;
      case 2: // touffe mauve (trèfle en fleur)
        px(cx,dx,dy,2,2,'#c9a0d9'); px(cx,dx+3,dy+2,2,2,'#c9a0d9');
        px(cx,dx+1,dy+4,2,2,'#b587c9');
        break;
      case 3: // champignon
        px(cx,dx,dy,2,4,'#e8dcc0');
        cx.fillStyle='#b8443a'; cx.beginPath(); cx.ellipse(dx+1,dy-2,3.2,2.2,0,0,Math.PI*2); cx.fill();
        cx.fillStyle='#f0d0c8'; px(cx,dx,dy-3,1,1,'#f0d0c8'); px(cx,dx+2,dy-2,1,1,'#f0d0c8');
        break;
      case 4: // brindille sèche
        cx.strokeStyle='#6a4e28'; cx.lineWidth=1.4;
        cx.beginPath(); cx.moveTo(dx-4,dy+2); cx.lineTo(dx+4,dy-2); cx.stroke();
        cx.beginPath(); cx.moveTo(dx-1,dy); cx.lineTo(dx+1,dy-3); cx.stroke();
        break;
      case 5: // marguerite blanche
        px(cx,dx,dy,1,3,'#3a6024');
        cx.fillStyle='#eef0e4';
        for(const[petX,petY] of [[-2,0],[2,0],[0,-2],[0,2],[-1.4,-1.4],[1.4,1.4]]){
          cx.beginPath(); cx.ellipse(dx+petX,dy-2+petY,1.3,0.9,Math.atan2(petY,petX),0,Math.PI*2); cx.fill();
        }
        cx.fillStyle='#e8c840'; cx.beginPath(); cx.arc(dx,dy-2,1.2,0,Math.PI*2); cx.fill();
        break;
      case 6: // feuilles mortes
        px(cx,dx,dy,3,2,'#a86a2e'); px(cx,dx+4,dy+2,2,2,'#c88838');
        break;
      default: // pousse claire (variation de hauteur d'herbe)
        px(cx,dx,dy,2,5,'#3f6b28'); px(cx,dx+2,dy+2,2,3,'#4a7d30');
    }

    // Touffes sur les bords : estompe la limite entre tuiles voisines.
    // Réparties sur les QUATRE bords à chaque fois (et non tirées au hasard),
    // pour qu'aucune tuile ne présente un côté nu contre un côté chargé —
    // c'est ce déséquilibre qui dessinait des lignes de séparation nettes.
    for(let e=0;e<4;e++) for(let i=0;i<4;i++){
      const o=(rnd()*T)|0, dth=Math.max(2,T/14|0);
      cx.fillStyle=rnd()<0.5?'rgba(70,110,45,.16)':'rgba(110,155,72,.13)';
      if(e===0) cx.fillRect(o,0,dth,dth); else if(e===1) cx.fillRect(o,T-dth,dth,dth);
      else if(e===2) cx.fillRect(0,o,dth,dth); else cx.fillRect(T-dth,o,dth,dth);
    }
    SPR.terrain['grass'+v]={c,cx};
    // Trois copies miroir par variante (H, V, HV). 8 textures deviennent 32
    // orientations : sur une carte de 3 600 cases, deux tuiles identiques
    // côte à côte deviennent rares, et le motif répétitif disparaît sans
    // coûter une seule texture supplémentaire à dessiner à la main.
    for(const m of [1,2,3]){
      const f=offCanvas(T,T);
      f.cx.save();
      f.cx.translate((m&1)?T:0,(m&2)?T:0);
      f.cx.scale((m&1)?-1:1,(m&2)?-1:1);
      f.cx.drawImage(c,0,0);
      f.cx.restore();
      SPR.terrain['grass'+v+'m'+m]=f;
    }
  }

  // Sable (rives) — grain plus riche, dégradé et quelques galets/bois flotté
  {
    const{c,cx}=offCanvas(T,T); const rnd=srnd(555);
    px(cx,0,0,T,T,'#d9c48a');
    const step=Math.max(3,T/10|0);
    for(let y=0;y<T;y+=step) for(let x=0;x<T;x+=step){
      const r=rnd();
      if(r<0.18) px(cx,x,y,step,step,'rgba(170,140,85,.35)');
      else if(r<0.30) px(cx,x,y,step,step,'rgba(245,232,185,.5)');
    }
    for(let i=0;i<10;i++){
      const dx=(rnd()*T)|0, dy=(rnd()*T)|0;
      cx.fillStyle=rnd()<0.5?'rgba(90,70,35,.3)':'rgba(255,250,225,.35)';
      cx.fillRect(dx,dy,1,1);
    }
    if(rnd()<0.6){ const gx=(rnd()*(T-8)|0)+4, gy=(rnd()*(T-8)|0)+4; px(cx,gx,gy,3,2,'#8a7550'); px(cx,gx,gy,2,1,'#a89068'); }
    SPR.terrain.sand={c,cx};
  }
  if(partie===1) return;   // l'eau viendra à l'image suivante
  buildTerrainEau(T);
}

function buildTerrainEau(T){
  // ── EAU ───────────────────────────────────────────────────────────
  // La version d'origine posait, sur CHAQUE tuile, quatre barres claires
  // horizontales pleine largeur et trois barres verticales pleine hauteur,
  // toujours aux mêmes coordonnées. Assemblées, ces barres se prolongeaient
  // d'une tuile à l'autre sur toute la longueur du lac : un lac entier se
  // lisait comme du papier millimétré, de loin le pire défaut du rendu.
  //
  // Ici, deux principes :
  //  1. Aucune ligne droite. Les crêtes sont des sinusoïdes dont le déphasage
  //     revient exactement à zéro aux bords gauche et droit de la tuile
  //     (période entière sur T) — elles se raccordent donc parfaitement à la
  //     tuile voisine sans jamais former de segment rectiligne.
  //  2. WATER_VARIANTS jeux de crêtes différents, choisis par un hachage de
  //     la position (comme l'herbe) : deux tuiles voisines n'ont ni les mêmes
  //     hauteurs de crête ni les mêmes amplitudes, donc plus rien ne s'aligne
  //     à l'échelle du lac.
  // Les barres verticales, elles, disparaissent purement et simplement : rien
  // dans une surface d'eau vue de dessus ne justifie un réseau orthogonal.
  for(let v=0;v<WATER_VARIANTS;v++) for(let f=0;f<4;f++){
    const{c,cx}=offCanvas(T,T); const rnd=srnd(v*131+f*31+7);
    px(cx,0,0,T,T,'#215f92');
    // Fonds : deux bandes très sombres et très douces, elles aussi ondulées,
    // qui donnent un peu de profondeur sans marquer de bord de tuile.
    const bande=(base,amp,per,ph,thick,col)=>{
      cx.strokeStyle=col; cx.lineWidth=thick; cx.lineCap='round'; cx.lineJoin='round';
      // Tracé répété en -T / 0 / +T : une crête qui déborde par le haut
      // ressort par le bas, donc la tuile reste raccordable verticalement.
      for(const off of [-T,0,T]){
        cx.beginPath();
        for(let x=0;x<=T;x+=2){
          const y=base+off+Math.sin(x/T*Math.PI*2*per+ph)*amp;
          if(x===0) cx.moveTo(x,y); else cx.lineTo(x,y);
        }
        cx.stroke();
      }
    };
    // Ces bandes-là sont volontairement IDENTIQUES d'une variante à l'autre
    // (aucun `v` dans leur position ni leur phase) : larges et sombres, elles
    // laisseraient une marche visible à chaque jointure si elles sautaient de
    // niveau entre deux tuiles voisines. Ce sont les crêtes claires, fines et
    // ondulées, qui portent toute la variété — leur décalage se lit comme du
    // clapot, pas comme une grille.
    for(let i=0;i<2;i++) bande((i+0.35)*T/2+f*T/9, T*0.07, 1, i*1.9, T*0.16, 'rgba(14,48,80,.16)');
    // Crêtes claires : 3 par tuile, hauteurs/amplitudes/périodes dépendantes
    // de la variante, décalées d'un quart de tuile par image d'animation.
    for(let i=0;i<3;i++){
      const base=((i+0.5)*T/3 + v*T*0.11 + f*T/4)%T;
      const amp=T*(0.025+0.030*(((v+i)%3)/2));
      const per=1+((v+i)%2);           // 1 ou 2 ondulations complètes
      const ph=(v*2.1+i*1.3);
      bande(base, amp, per, ph, Math.max(1.2,T*0.028), 'rgba(206,234,255,.20)');
      bande(base-T*0.035, amp, per, ph, Math.max(1,T*0.016), 'rgba(255,255,255,.16)');
    }
    // éclats de soleil scintillants
    for(let i=0;i<4;i++){
      const sx2=(rnd()*T)|0, sy2=(rnd()*T)|0;
      cx.fillStyle='rgba(255,255,255,.5)'; cx.fillRect(sx2,sy2,Math.max(1,T*0.012|0),Math.max(1,T*0.012|0));
    }
    SPR.terrain['water'+v+'_'+f]={c,cx};
  }
}

// ── ARBRES (canopée organique en couches, tronc texturé + ombre) ──
// Passe « haut de gamme » : silhouette de canopée perturbée par secteur
// angulaire (pas un cercle parfait), tronc légèrement conique avec stries
// d'écorce, reflet directionnel décalé haut-gauche (cohérent avec le reste
// du décor), 5 palettes au lieu de 3 pour varier les forêts.
function buildTrees(T){
  SPR.tree=[];
  // Toutes les variantes de feuillage sont remplacees par la meme
  // illustration d'arbre (voir upgradeResourceNodes) : quand elle est prete,
  // les peindre en dessous est du travail integralement jete — et c'est le
  // plus cher des gisements.
  const illus=illustrationPrete('assets/ressources/arbre'+ASSET_EXT);
  const palettes=[
    ['#1f4a18','#2f6322','#3f7d2e','#4f9038'],   // chêne classique
    ['#244e1a','#356128','#458038','#56a046'],   // frêne clair
    ['#1b4416','#2a5520','#3a6e2c','#4a873a'],   // vert profond
    ['#2c4a14','#44631f','#5d7d2a','#7a9838'],   // olivier / feuillage sec
    ['#122e2a','#1c443c','#2a5f52','#3c7d6c'],   // conifère sombre (bleuté)
  ];
  for(let v=0;v<palettes.length;v++){
    const S=Math.round(T*1.5);
    const{c,cx}=offCanvas(S,S);
    if(illus){ SPR.tree.push({c,cx,S:S/SS}); continue; }
    const pal=palettes[v];
    const rnd=srnd(v*211+41);
    const midX=S/2, groundY=S*0.95;
    // ombre au sol (ellipse pixel)
    cx.fillStyle='rgba(0,0,0,.22)';
    cx.beginPath(); cx.ellipse(midX,groundY,S*0.22,S*0.05,0,0,Math.PI*2); cx.fill();
    // tronc conique (plus large à la base) + stries d'écorce
    const twBase=Math.max(4,Math.round(S*0.13)), twTop=Math.max(3,Math.round(S*0.09));
    const trunkH=Math.round(S*0.4), trunkY=Math.round(groundY-trunkH);
    cx.fillStyle='#4a3018';
    cx.beginPath();
    cx.moveTo(midX-twBase/2,groundY); cx.lineTo(midX-twTop/2,trunkY);
    cx.lineTo(midX+twTop/2,trunkY); cx.lineTo(midX+twBase/2,groundY);
    cx.closePath(); cx.fill();
    px(cx,Math.round(midX-twBase/2),trunkY,Math.max(2,Math.round(twBase*0.4)),trunkH,'#5e3e22');
    cx.strokeStyle='rgba(0,0,0,.25)'; cx.lineWidth=1;
    for(let i=0;i<3;i++){
      const sxo=midX-twBase*0.3+i*twBase*0.3;
      cx.beginPath(); cx.moveTo(sxo,trunkY+2); cx.lineTo(sxo+1,groundY-2); cx.stroke();
    }
    // canopée : silhouette perturbée par secteur angulaire plutôt qu'un
    // cercle géométrique — une fois le sprite réduit avec lissage, le bord
    // se lit comme un feuillage déchiqueté et naturel.
    const SEC=12, jitter=[];
    for(let i=0;i<SEC;i++) jitter.push(0.78+rnd()*0.44);
    const step=Math.max(2,Math.round(S/24));
    const layer=(cxOff,cyOff,rad,col)=>{
      const ccx=midX+cxOff, ccy=groundY-S*0.42+cyOff;
      for(let yy=-rad;yy<=rad;yy+=step) for(let xx=-rad;xx<=rad;xx+=step){
        const sec=(((Math.atan2(yy,xx)+Math.PI)/(Math.PI*2))*SEC|0)%SEC;
        const rr=rad*jitter[sec];
        if(xx*xx+yy*yy<=rr*rr) px(cx,Math.round(ccx+xx),Math.round(ccy+yy),step,step,col);
      }
    };
    const xo=(rnd()-0.5)*S*0.06; // léger décalage horizontal : silhouette asymétrique
    layer(xo*0.4,0,          S*0.34, pal[0]);
    layer(xo*0.7,-S*0.08,    S*0.30, pal[1]);
    layer(xo,    -S*0.16,    S*0.26, pal[2]);
    layer(xo*1.2,-S*0.24,    S*0.19, pal[3]);
    // reflet directionnel : décalé haut-gauche plutôt que pile au sommet,
    // cohérent avec la lumière du reste du décor (herbe, bâtiments).
    layer(xo*1.2-S*0.09,-S*0.30, S*0.10, pal[3]);
    SPR.tree.push({c,cx,S:S/SS});
  }
}

// ── PIERRE / OR (rochers anguleux, facettés) ──────────────
// Passe « haut de gamme » : vrais polygones irréguliers (pas des rectangles
// arrondis empilés) avec facette éclairée, facette ombrée et fissures —
// plus lisiblement « rocheux » qu'un blob. Pierre et Or partagent la même
// géométrie de socle mais divergent nettement en lecture : granite gris
// clivé pour la Pierre, affleurement sombre incrusté de pépites et
// d'éclats scintillants pour l'Or (pour qu'on les distingue au premier
// coup d'œil, pas seulement à la couleur de fond).
function rockChunk(cx,cxp,cyp,r,rnd,baseCol,liteCol,darkCol){
  const sides=5+((rnd()*3)|0), verts=[];
  for(let i=0;i<sides;i++){
    const a=(i/sides)*Math.PI*2, rr=r*(0.72+rnd()*0.4);
    verts.push([cxp+Math.cos(a)*rr, cyp+Math.sin(a)*rr*0.82]);
  }
  const trace=()=>{ cx.beginPath(); verts.forEach(([x,y],i)=>i===0?cx.moveTo(x,y):cx.lineTo(x,y)); cx.closePath(); };
  trace(); cx.fillStyle=baseCol; cx.fill();
  cx.save(); trace(); cx.clip();
  cx.fillStyle=liteCol;
  cx.beginPath(); cx.ellipse(cxp-r*0.28,cyp-r*0.30,r*0.62,r*0.42,-0.3,0,Math.PI*2); cx.fill();
  cx.globalAlpha=0.5; cx.fillStyle=darkCol;
  cx.beginPath(); cx.ellipse(cxp+r*0.32,cyp+r*0.28,r*0.55,r*0.4,0.3,0,Math.PI*2); cx.fill();
  cx.globalAlpha=1;
  cx.restore();
  cx.strokeStyle='rgba(0,0,0,.28)'; cx.lineWidth=1; trace(); cx.stroke();
}

function buildStoneNode(T){
  SPR.stone=[];
  const illus=illustrationPrete('assets/ressources/gisement_pierre'+ASSET_EXT);
  for(let v=0;v<3;v++){
    const S=Math.round(T*1.05);
    const{c,cx}=offCanvas(S,S);
    // Remplace en entier par l'illustration : ne pas peindre dessous.
    if(illus){ SPR.stone.push({c,cx,S:S/SS}); continue; }
    const rnd=srnd(v*331+91);
    const cxp=S/2, cyp=S*0.58;
    cx.fillStyle='rgba(0,0,0,.22)';
    cx.beginPath(); cx.ellipse(cxp,cyp+S*0.22,S*0.34,S*0.08,0,0,Math.PI*2); cx.fill();
    rockChunk(cx,cxp-S*0.16,cyp+S*0.02,S*0.24,rnd,'#6a6a72','#a8a8b0','#45454c');
    rockChunk(cx,cxp+S*0.16,cyp+S*0.05,S*0.19,rnd,'#63636a','#9d9da6','#3f3f46');
    rockChunk(cx,cxp,cyp-S*0.14,S*0.17,rnd,'#75757c','#b0b0b8','#4d4d54');
    cx.strokeStyle='rgba(20,20,24,.35)'; cx.lineWidth=1;
    for(let i=0;i<3;i++){
      const bx=cxp+(rnd()-0.5)*S*0.3, by=cyp+(rnd()-0.5)*S*0.2;
      cx.beginPath(); cx.moveTo(bx,by); cx.lineTo(bx+(rnd()-0.5)*S*0.12,by+S*0.08); cx.stroke();
    }
    if(rnd()<0.4){ cx.fillStyle='rgba(120,150,70,.35)'; cx.beginPath(); cx.arc(cxp+S*0.1,cyp-S*0.05,S*0.05,0,Math.PI*2); cx.fill(); }
    SPR.stone.push({c,cx,S:S/SS});
  }
}

function buildGoldNode(T){
  SPR.gold=[];
  const illus=illustrationPrete('assets/ressources/gisement_or'+ASSET_EXT);
  for(let v=0;v<3;v++){
    const S=Math.round(T*1.05);
    const{c,cx}=offCanvas(S,S);
    // Remplace en entier par l'illustration : ne pas peindre dessous.
    if(illus){ SPR.gold.push({c,cx,S:S/SS}); continue; }
    const rnd=srnd(v*457+131);
    const cxp=S/2, cyp=S*0.58;
    cx.fillStyle='rgba(0,0,0,.22)';
    cx.beginPath(); cx.ellipse(cxp,cyp+S*0.22,S*0.34,S*0.08,0,0,Math.PI*2); cx.fill();
    rockChunk(cx,cxp-S*0.14,cyp+S*0.02,S*0.24,rnd,'#5a4a3a','#7a6650','#332820');
    rockChunk(cx,cxp+S*0.17,cyp+S*0.05,S*0.18,rnd,'#544438','#75604c','#302620');
    // pépites incrustées : socle sombre → cœur doré → reflet clair
    const nug=(ox,oy,r)=>{
      cx.fillStyle='#8b6410'; cx.beginPath(); cx.ellipse(cxp+ox,cyp+oy,r,r*0.75,0,0,Math.PI*2); cx.fill();
      cx.fillStyle='#e0b020'; cx.beginPath(); cx.ellipse(cxp+ox-r*0.2,cyp+oy-r*0.2,r*0.6,r*0.45,0,0,Math.PI*2); cx.fill();
      cx.fillStyle='#ffe488'; cx.beginPath(); cx.ellipse(cxp+ox-r*0.35,cyp+oy-r*0.32,r*0.24,r*0.18,0,0,Math.PI*2); cx.fill();
    };
    nug(-S*0.02,-S*0.06,S*0.13);
    nug(S*0.14,S*0.05,S*0.09);
    nug(-S*0.16,S*0.08,S*0.07);
    // scintillements (croix lumineuses, façon éclat de gemme)
    for(let i=0;i<3;i++){
      const sx2=cxp+(rnd()-0.5)*S*0.4, sy2=cyp+(rnd()-0.5)*S*0.3;
      cx.strokeStyle='rgba(255,245,200,.9)'; cx.lineWidth=1;
      cx.beginPath(); cx.moveTo(sx2-2,sy2); cx.lineTo(sx2+2,sy2); cx.moveTo(sx2,sy2-2); cx.lineTo(sx2,sy2+2); cx.stroke();
    }
    SPR.gold.push({c,cx,S:S/SS});
  }
}

// ── BAIES (buisson feuillu, fruits nombreux) ──────────────
// Passe « haut de gamme » : touffes de feuillage superposées et
// asymétriques (comme une mini-canopée) au lieu d'une seule ellipse plate,
// davantage de fruits avec reflet, et 2 variantes pour casser la répétition.
function buildBerry(T){
  SPR.berry=[];
  const illus=illustrationPrete('assets/ressources/buisson_baies'+ASSET_EXT);
  for(let v=0;v<3;v++){
    const S=Math.round(T*1.05);
    const{c,cx}=offCanvas(S,S);
    // Remplace en entier par l'illustration : ne pas peindre dessous.
    if(illus){ SPR.berry.push({c,cx,S:S/SS}); continue; }
    const rnd=srnd(v*613+211);
    const cxp=S/2, cyp=S*0.56;
    cx.fillStyle='rgba(0,0,0,.18)';
    cx.beginPath(); cx.ellipse(cxp,cyp+S*0.2,S*0.3,S*0.07,0,0,Math.PI*2); cx.fill();
    const leafCol=['#2a5f22','#356e2a','#428038'];
    const clump=(ox,oy,r,col)=>{
      const step=Math.max(2,S/20|0);
      for(let yy=-r;yy<=r;yy+=step) for(let xx=-r;xx<=r;xx+=step)
        if(xx*xx/1.25+yy*yy<=r*r) px(cx,Math.round(cxp+ox+xx),Math.round(cyp+oy+yy),step,step,col);
    };
    clump(-S*0.1,S*0.02,S*0.22,leafCol[0]);
    clump(S*0.12,S*0.0,S*0.19,leafCol[1]);
    clump(0,-S*0.1,S*0.16,leafCol[2]);
    // fruits nombreux, taille et position variées avec reflet
    const st=Math.max(2,S/11|0);
    const spots=[[-0.18,-0.02],[0.14,-0.08],[0.02,0.1],[-0.22,0.12],[0.2,0.06],[-0.02,-0.14],[0.1,0.16],[-0.1,0.18]];
    for(const[fx,fy] of spots){
      const bx=cxp+fx*S, by=cyp+fy*S;
      cx.fillStyle='#a5281f'; cx.beginPath(); cx.arc(bx,by,st*0.62,0,Math.PI*2); cx.fill();
      cx.fillStyle='#e35b4a'; cx.beginPath(); cx.arc(bx-st*0.18,by-st*0.18,st*0.32,0,Math.PI*2); cx.fill();
      cx.fillStyle='rgba(255,255,255,.5)'; cx.fillRect((bx-st*0.28)|0,(by-st*0.28)|0,1,1);
    }
    SPR.berry.push({c,cx,S:S/SS});
  }
}

// ── BANC DE POISSONS : jusqu'ici un gisement RT.FISH sans case dédiée
// dans drawNodes() retombait sur SPR.berry — un buisson à baies flottant
// sur l'eau. Trois argentés, nageoire caudale et reflet dorsal. ──
function buildFish(T){
  SPR.fish=[];
  const illus=illustrationPrete('assets/ressources/banc_poissons'+ASSET_EXT);
  for(let v=0;v<3;v++){
    const S=Math.round(T*0.9);
    const{c,cx}=offCanvas(S,S);
    // Remplace en entier par l'illustration : ne pas peindre dessous.
    if(illus){ SPR.fish.push({c,cx,S:S/SS}); continue; }
    const cxp=S/2, cyp=S*0.56;
    cx.fillStyle='rgba(255,255,255,.22)'; // onde de surface sous le banc
    cx.beginPath(); cx.ellipse(cxp,cyp+S*0.22,S*0.28,S*0.06,0,0,Math.PI*2); cx.fill();
    const scaleCol=['#5a90b0','#6aa0c0','#4a80a0'];
    const spots=[[-0.16,-0.04,0],[0.12,-0.1,0.4],[0.02,0.08,-0.3],[-0.2,0.12,0.2],[0.18,0.1,-0.2]];
    for(let i=0;i<spots.length;i++){
      const [fx,fy,rot]=spots[i];
      const bx=cxp+fx*S, by=cyp+fy*S, fs=S*0.16;
      const col=scaleCol[i%scaleCol.length];
      cx.save(); cx.translate(bx,by); cx.rotate(rot);
      cx.fillStyle=shade(col,-22);
      cx.beginPath(); cx.moveTo(-fs,0); cx.lineTo(-fs*1.5,-fs*0.4); cx.lineTo(-fs*1.5,fs*0.4); cx.closePath(); cx.fill(); // caudale
      cx.fillStyle=col;
      cx.beginPath(); cx.ellipse(0,0,fs,fs*0.42,0,0,Math.PI*2); cx.fill();
      cx.fillStyle='rgba(255,255,255,.55)';
      cx.beginPath(); cx.ellipse(fs*0.25,-fs*0.12,fs*0.3,fs*0.14,0,0,Math.PI*2); cx.fill(); // reflet dorsal
      cx.restore();
    }
    SPR.fish.push({c,cx,S:S/SS});
  }
}

// ── DÉPOUILLE (gibier abattu, RT.MEAT) : même bug que le poisson, une
// carcasse de cerf/sanglier se lisait comme un buisson à baies. Chair
// crue + os croisés, façon quartier de viande posé au sol. ──
function buildMeat(T){
  SPR.meat=[];
  const illus=illustrationPrete('assets/ressources/viande'+ASSET_EXT);
  for(let v=0;v<2;v++){
    const S=Math.round(T*0.95);
    const{c,cx}=offCanvas(S,S);
    // Remplace en entier par l'illustration : ne pas peindre dessous.
    if(illus){ SPR.meat.push({c,cx,S:S/SS}); continue; }
    const cxp=S/2, cyp=S*0.58;
    cx.fillStyle='rgba(0,0,0,.2)';
    cx.beginPath(); cx.ellipse(cxp,cyp+S*0.2,S*0.26,S*0.06,0,0,Math.PI*2); cx.fill();
    const meatCol=['#8a3a2a','#a04a34'];
    const spots=[[-0.1,-0.02,0.22],[0.1,0.02,0.2],[0,0.1,0.16]];
    for(let i=0;i<spots.length;i++){
      const [fx,fy,r]=spots[i];
      const bx=cxp+fx*S, by=cyp+fy*S, rr=S*r;
      cx.fillStyle=meatCol[i%meatCol.length];
      cx.beginPath(); cx.ellipse(bx,by,rr,rr*0.75,0,0,Math.PI*2); cx.fill();
      cx.fillStyle='rgba(255,255,255,.25)';
      cx.beginPath(); cx.ellipse(bx-rr*0.3,by-rr*0.25,rr*0.3,rr*0.15,0,0,Math.PI*2); cx.fill();
    }
    cx.strokeStyle='#e8ddc0'; cx.lineWidth=Math.max(2,S*0.035); // os croisés : lit "carcasse" d'un coup d'œil
    cx.beginPath(); cx.moveTo(cxp-S*0.16,cyp-S*0.12); cx.lineTo(cxp+S*0.06,cyp+S*0.1); cx.stroke();
    cx.beginPath(); cx.moveTo(cxp+S*0.06,cyp-S*0.12); cx.lineTo(cxp-S*0.16,cyp+S*0.1); cx.stroke();
    SPR.meat.push({c,cx,S:S/SS});
  }
}

// ── RELIQUE AU SOL : jusqu'ici un fillText('🏺') brut. Amphore d'argile,
// anses, liseré doré et légère lueur (objet précieux, se distingue au sol). ──
function buildRelic(T){
  const S=Math.round(T*0.85);
  const{c,cx}=offCanvas(S,S);
  const cxp=S/2;
  cx.fillStyle='rgba(0,0,0,.22)';
  cx.beginPath(); cx.ellipse(cxp,S*0.86,S*0.22,S*0.05,0,0,Math.PI*2); cx.fill();
  cx.fillStyle='rgba(255,224,140,.35)'; // lueur : objet précieux, pas un pot ordinaire
  cx.beginPath(); cx.ellipse(cxp,S*0.4,S*0.34,S*0.4,0,0,Math.PI*2); cx.fill();
  const clay='#b8703a', clayDk=shade(clay,-25), gold='#caa83a', goldLt=shade(gold,25);
  cx.fillStyle=clay; // panse de l'amphore
  cx.beginPath();
  cx.moveTo(cxp-S*0.06,S*0.16);
  cx.quadraticCurveTo(cxp-S*0.28,S*0.3,cxp-S*0.24,S*0.56);
  cx.quadraticCurveTo(cxp-S*0.2,S*0.8,cxp,S*0.84);
  cx.quadraticCurveTo(cxp+S*0.2,S*0.8,cxp+S*0.24,S*0.56);
  cx.quadraticCurveTo(cxp+S*0.28,S*0.3,cxp+S*0.06,S*0.16);
  cx.closePath(); cx.fill();
  cx.fillStyle=clayDk;
  cx.beginPath(); cx.ellipse(cxp+S*0.1,S*0.5,S*0.12,S*0.26,0,0,Math.PI*2); cx.fill();
  cx.fillStyle=clay; cx.fillRect(cxp-S*0.08,S*0.06,S*0.16,S*0.14); // col
  cx.fillStyle=goldLt; cx.fillRect(cxp-S*0.1,S*0.04,S*0.2,S*0.04);  // liseré doré à l'embouchure
  cx.strokeStyle=clayDk; cx.lineWidth=Math.max(2,S*0.045); // anses
  cx.beginPath(); cx.moveTo(cxp-S*0.06,S*0.2); cx.quadraticCurveTo(cxp-S*0.34,S*0.28,cxp-S*0.22,S*0.44); cx.stroke();
  cx.beginPath(); cx.moveTo(cxp+S*0.06,S*0.2); cx.quadraticCurveTo(cxp+S*0.34,S*0.28,cxp+S*0.22,S*0.44); cx.stroke();
  cx.strokeStyle=gold; cx.lineWidth=Math.max(1,S*0.025); // motif
  cx.beginPath(); cx.moveTo(cxp-S*0.2,S*0.44); cx.lineTo(cxp+S*0.2,S*0.44); cx.stroke();
  SPR.relic={c,cx,S:S/SS};
}

// ── CARAVANE MARCHANDE : jusqu'ici un fillText('🐫') brut. Chameau chargé
// de sacoches, silhouette de bosse, vu de profil. ──
function buildCaravan(T){
  const S=Math.round(T*0.85);
  const{c,cx}=offCanvas(S,S);
  const cxp=S/2, gy=S*0.62;
  cx.fillStyle='rgba(0,0,0,.22)';
  cx.beginPath(); cx.ellipse(cxp,S*0.86,S*0.26,S*0.05,0,0,Math.PI*2); cx.fill();
  const col='#c9a869', dk=shade(col,-26), pack='#8a5a2c', packDk=shade(pack,-20);
  for(const ox of [-0.2,-0.08,0.1,0.2]) px(cx,cxp+ox*S,gy,S*0.05,S*0.24,dk);
  cx.fillStyle=col; // corps + bosse
  cx.beginPath();
  cx.moveTo(cxp-S*0.3,gy);
  cx.quadraticCurveTo(cxp-S*0.26,gy-S*0.28,cxp-S*0.1,gy-S*0.3);
  cx.quadraticCurveTo(cxp+S*0.02,gy-S*0.32,cxp+S*0.1,gy-S*0.22);
  cx.quadraticCurveTo(cxp+S*0.3,gy-S*0.16,cxp+S*0.3,gy-S*0.02);
  cx.quadraticCurveTo(cxp+S*0.1,gy+S*0.14,cxp-S*0.3,gy+S*0.12);
  cx.closePath(); cx.fill();
  px(cx,cxp-S*0.14,gy-S*0.14,S*0.14,S*0.16,pack);        // sacoche avant
  px(cx,cxp-S*0.14,gy-S*0.14,S*0.14,Math.max(1,S*0.03),shade(pack,20));
  px(cx,cxp+S*0.02,gy-S*0.16,S*0.14,S*0.16,packDk);       // sacoche arrière
  cx.fillStyle=col; // encolure + tête
  cx.beginPath();
  cx.moveTo(cxp+S*0.24,gy-S*0.06); cx.quadraticCurveTo(cxp+S*0.4,gy-S*0.22,cxp+S*0.36,gy-S*0.4);
  cx.quadraticCurveTo(cxp+S*0.3,gy-S*0.48,cxp+S*0.24,gy-S*0.4); cx.quadraticCurveTo(cxp+S*0.3,gy-S*0.2,cxp+S*0.2,gy-S*0.02);
  cx.closePath(); cx.fill();
  px(cx,cxp+S*0.32,gy-S*0.4,Math.max(1,S*0.03),Math.max(1,S*0.03),'#1a1410'); // œil
  px(cx,cxp-S*0.32,gy-S*0.02,S*0.04,S*0.14,dk);           // queue
  SPR.caravan={c,cx,S:S/SS};
}

// ── BÂTIMENTS (toits, murs, fenêtres en pixel art) ───────
// L'illustration ecrase de toute facon le sprite procedural. Des la deuxieme
// generation — c'est-a-dire a TOUS les changements de zoom — son detourage
// est deja en cache, donc peindre le sprite procedural en dessous est du
// travail integralement jete : ce test le saute.
function illustrationPrete(url){ return AI_SRC_STATE[url]==='ready'; }

// `i0`/`i1` découpent la liste des types pour la reconstruction étalée : les
// bâtiments sont la deuxième plus grosse étape (~27 ms au zoom maximum), à
// cause des variantes d'âge et de niveau qui n'ont pas d'illustration et
// restent donc peintes à la main.
function buildBuildings(T,i0,i1){
  const types=Object.keys(BDEF);
  if(i0==null){ i0=0; i1=types.length; }
  if(i0===0){ SPR.bld={}; SPR.bldCiv={}; }
  for(const type of types.slice(i0,i1)){
    const d=BDEF[type];
    const pw=d.w*T, ph=d.h*T;
    const dw=pw/SS, dh=(ph+T*0.5)/SS, oy=(T*0.5)/SS; // dimensions logiques d'affichage
    // Seules les formes « age 0 / niveau 1 » ont une illustration : les
    // variantes d'age et de niveau construites plus bas restent procedurales.
    const illus=BLD_SPRITE_FILES[type]
      ? illustrationPrete('assets/batiments/'+BLD_SPRITE_FILES[type]+ASSET_EXT) : false;
    const{c,cx}=offCanvas(pw,ph+T*0.5); // marge pour toit en relief
    if(!illus) drawBuildingSprite(cx,type,d,pw,ph,T,false);
    SPR.bld[type]={c,cx,oy,dw,dh};
    // version ennemie (teinte rouge)
    const{c:ce,cx:cxe}=offCanvas(pw,ph+T*0.5);
    if(!illus) drawBuildingSprite(cxe,type,d,pw,ph,T,true);
    SPR.bld[type+'_E']={c:ce,cx:cxe,oy,dw,dh};
    // Tour Défensive : variantes visuelles pour les niveaux 2 et 3
    // (bannière de garde, puis créneaux renforcés) — même géométrie de
    // clic/collision (tx,ty,w,h inchangés), seul l'habillage change.
    if(type===BT.TOWER){
      for(const lvl of [2,3]){
        const{c:cl,cx:cxl}=offCanvas(pw,ph+T*0.5);
        if(!illus) drawBuildingSprite(cxl,type,d,pw,ph,T,false,lvl);
        SPR.bld[type+'_L'+lvl]={c:cl,cx:cxl,oy,dw,dh};
        const{c:cle,cx:cxle}=offCanvas(pw,ph+T*0.5);
        if(!illus) drawBuildingSprite(cxle,type,d,pw,ph,T,true,lvl);
        SPR.bld[type+'_L'+lvl+'_E']={c:cle,cx:cxle,oy,dw,dh};
      }
    }
    // Portail : variante ouverte (vantail rabattu, passage dégagé), en plus
    // du sprite de base qui sert d'état fermé — même géométrie que le Mur.
    if(type===BT.GATE){
      const{c:co,cx:cxo}=offCanvas(pw,ph+T*0.5);
      if(!illus) drawBuildingSprite(cxo,type,d,pw,ph,T,false,1,0,true);
      SPR.bld[type+'_OPEN']={c:co,cx:cxo,oy,dw,dh};
      const{c:coe,cx:cxoe}=offCanvas(pw,ph+T*0.5);
      if(!illus) drawBuildingSprite(cxoe,type,d,pw,ph,T,true,1,0,true);
      SPR.bld[type+'_OPEN_E']={c:coe,cx:cxoe,oy,dw,dh};
    }
    // Centre Ville, Caserne et Mur : habillage qui s'enrichit avec les âges
    // du joueur (renforts de pierre, tourelles, dorures...), pour que la
    // progression d'âge se voie sur la carte et pas seulement dans les
    // chiffres de la topbar. Même géométrie de clic/collision, seul
    // l'habillage change — comme pour les niveaux de la Tour Défensive.
    // Le Mur passe ainsi de palissade de bois (Âge Sombre) à mur de pierre
    // fortifié (Âge Impérial), sans palier d'amélioration séparé à acheter :
    // ses PV suivent déjà le bonus d'âge générique (voir updateAgeUp).
    if(type===BT.TC||type===BT.BARRACKS||type===BT.WALL){
      for(const age of [1,2,3]){
        const{c:ca,cx:cxa}=offCanvas(pw,ph+T*0.5);
        if(!illus) drawBuildingSprite(cxa,type,d,pw,ph,T,false,1,age);
        SPR.bld[type+'_A'+age]={c:ca,cx:cxa,oy,dw,dh};
        const{c:cae,cx:cxae}=offCanvas(pw,ph+T*0.5);
        if(!illus) drawBuildingSprite(cxae,type,d,pw,ph,T,true,1,age);
        SPR.bld[type+'_A'+age+'_E']={c:cae,cx:cxae,oy,dw,dh};
      }
    }
  }
}

// ── SURCOUCHE : bâtiments illustrés, en amélioration progressive ──────
// par-dessus les sprites procéduraux ci-dessus (même principe que les
// icônes de ressources, voir upgradeResourceIcons). Chargement asynchrone
// depuis assets/batiments/ ; échec silencieux (fichier absent, jeu en
// file:// sans serveur, canvas « taint ») → le sprite procédural déjà
// généré reste utilisé tel quel. Ne couvre volontairement que la forme
// « âge 0 / niveau 1 » de chaque bâtiment : les variantes d'âge (Centre
// Ville, Caserne, Mur passé Âge Sombre) et de niveau (Tour) restent
// procédurales tant qu'elles n'ont pas leur propre illustration.
const BLD_SPRITE_FILES={ [BT.HOUSE]:'maison', [BT.FARM]:'ferme', [BT.BARRACKS]:'caserne', [BT.TC]:'centre_ville', [BT.WALL]:'mur', [BT.TOWER]:'tour', [BT.CASTLE]:'chateau', [BT.GATE]:'portail', [BT.MARKET]:'marche', [BT.SIEGE]:'atelier_siege', [BT.OUTPOST]:'avant_poste', [BT.UNIV]:'universite', [BT.DOCK]:'quai', [BT.MILL]:'moulin', [BT.LUMBER]:'camp_bois', [BT.MINE]:'camp_minier', [BT.STABLE]:'ecurie', [BT.MONASTERY]:'monastere', [BT.FORGE]:'forge', [BT.HLM]:'hlm', [BT.WONDER]:'merveille' };

// Illustrations DÉDIÉES par palier d'âge (1 = Féodal, 2 = Châteaux, 3 =
// Impérial), en plus de la forme de base (âge 0, ci-dessus) — pour les
// bâtiments où la progression visuelle d'âge est assez lue pour mériter sa
// propre image plutôt que de réutiliser celle de l'âge précédent. Un type
// absent d'ici garde le comportement par défaut : la même illustration à
// tous les âges (voir upgradeBuildingSprites).
const BLD_AGE_SPRITE_FILES={
  [BT.TC]: { 1:'centre_ville_age1', 2:'centre_ville_age2', 3:'centre_ville_age3' },
};

// Illustrations DÉDIÉES par CIVILISATION (en plus de l'âge ci-dessus) : pour
// un bâtiment listé ici, chaque civilisation autre que 'francs' a son propre
// jeu de 4 images (âges 0 à 3). 'francs' n'a pas besoin d'entrée : son style
// (chateau de pierre occidental) EST déjà le sprite de base et ses âges
// dédiés (BLD_AGE_SPRITE_FILES ci-dessus) — inutile de dupliquer ces
// fichiers sous un autre nom. Rangées à part dans SPR.bldCiv (et non
// mélangées à SPR.bld) : la très large majorité des bâtiments n'a qu'un seul
// style, pas la peine de leur faire porter des clés « _francs » inutiles.
const BLD_CIV_SPRITE_FILES={
  [BT.TC]: {
    byzantins: { 0:'centre_ville_byzantins', 1:'centre_ville_byzantins_age1', 2:'centre_ville_byzantins_age2', 3:'centre_ville_byzantins_age3' },
    chinois:   { 0:'centre_ville_chinois',   1:'centre_ville_chinois_age1',   2:'centre_ville_chinois_age2',   3:'centre_ville_chinois_age3' },
    mongols:   { 0:'centre_ville_mongols',   1:'centre_ville_mongols_age1',   2:'centre_ville_mongols_age2',   3:'centre_ville_mongols_age3' },
  },
};

// Détoure le fond (même flood fill que les icônes, voir stripBgTrimmed),
// puis insère le résultat sans déformation (« contain »), ancré en bas et
// centré horizontalement dans un canvas de dimensions (W,H) identiques au
// sprite procédural remplacé — la géométrie de placement à l'affichage ne
// change donc pas.
function fitBuildingImage(src,W,H){
  const t=stripBgTrimmed(src,TRIM_W_BLD); if(!t) return null;
  const{c:wc,minX,minY,bw,bh}=t;
  const{c,cx}=offCanvas(W,H);
  const scale=Math.min(W*0.94/bw,H*0.94/bh);
  const dw=bw*scale, dh=bh*scale;
  cx.drawImage(wc,minX,minY,bw,bh,(W-dw)/2,H-dh,dw,dh);
  return{c,cx};
}

// Copie atténuée d'un sprite — sert au Portail ouvert (voir
// upgradeBuildingSprites), où la translucidité dit « le passage est libre ».
function fondu(base,W,H,alpha){
  const{c,cx}=offCanvas(W,H);
  cx.globalAlpha=alpha;
  cx.drawImage(base.c,0,0);
  cx.globalAlpha=1;
  return{c,cx};
}

// Variante « camp ennemi » : lavis rouge semi-transparent en surimpression,
// contraint à la silhouette déjà détourée (source-atop) — pas besoin d'une
// seconde image générée par bâtiment.
function tintEnemyBuilding(base,W,H){
  const{c,cx}=offCanvas(W,H);
  cx.drawImage(base.c,0,0);
  cx.globalCompositeOperation='source-atop';
  cx.fillStyle='rgba(200,40,40,.4)';
  cx.fillRect(0,0,W,H);
  cx.globalCompositeOperation='source-over';
  return{c,cx};
}

// buildBuildings(T) — et donc SPR.bld — est régénéré à chaque changement de
// zoom : la surcouche illustrée doit être réappliquée après chaque
// reconstruction, sans quoi le sprite procédural reprendrait le dessus. Le
// détourage, lui, est mutualisé par withIllustration/TRIM_CACHE : il ne reste
// ici qu'une mise à l'échelle, soit un drawImage par bâtiment.
function upgradeBuildingSprites(){
  for(const type in BLD_SPRITE_FILES){
    withIllustration('assets/batiments/'+BLD_SPRITE_FILES[type]+ASSET_EXT,TRIM_W_BLD,(url)=>{
      const meta=SPR.bld[type]; if(!meta) return;
      const W=meta.c.width, H=meta.c.height;
      const fitted=fitBuildingImage(url,W,H); if(!fitted) return;
      const fittedE=tintEnemyBuilding(fitted,W,H);
      // Le Portail OUVERT doit rester lisible d'un coup d'œil : c'est un état
      // de JEU (on passe / on ne passe pas), pas une simple coquetterie. Avec
      // la même illustration pour les deux états, plus rien ne le distinguait
      // du portail fermé. Il est donc peint en translucide — la convention
      // « on traverse » — plutôt que de retomber sur l'ancien sprite dessiné.
      const ouvert=fondu(fitted,W,H,0.45), ouvertE=fondu(fittedE,W,H,0.45);
      // TOUTES les variantes du type reçoivent l'illustration, pas seulement
      // la forme de base : âges (_A1.._A3 du Centre Ville, de la Caserne et
      // du Mur), niveaux (_L2/_L3 de la Tour) et portail ouvert (_OPEN).
      // Sans ça, avancer d'un âge faisait basculer le bâtiment sur son vieux
      // sprite procédural en pleine partie — l'illustration ne survivait
      // qu'à l'Âge Sombre. Le canvas est partagé entre variantes : elles
      // portent la même image, inutile d'en garder plusieurs copies.
      const prefixe=type+'_';
      // Âges qui ont leur PROPRE illustration (voir BLD_AGE_SPRITE_FILES) :
      // ce recouvrement générique doit leur laisser la place. Sans cette
      // exclusion, un cas de course réel se produisait : si le fichier de
      // base finit de charger APRÈS celui d'un âge (ordre d'arrivée réseau
      // non garanti, chaque withIllustration() ne fixe l'ordre que du
      // DÉCLENCHEMENT, pas de la RÉSOLUTION), ce recouvrement écrasait
      // après coup l'illustration dédiée déjà appliquée.
      const agesDedies=BLD_AGE_SPRITE_FILES[type]||{};
      for(const cle in SPR.bld){
        if(cle!==type&&!cle.startsWith(prefixe)) continue;
        const m=SPR.bld[cle];
        if(!m||m.c.width!==W||m.c.height!==H) continue;
        const mAge=cle.match(/^.+_A(\d)(_E)?$/);
        if(mAge&&agesDedies[mAge[1]]) continue;
        const estE=cle.endsWith('_E');
        const estOuvert=cle.startsWith(type+'_OPEN');
        SPR.bld[cle]=Object.assign({},m,
          estOuvert?(estE?ouvertE:ouvert):(estE?fittedE:fitted));
      }
    });
    // Illustrations dédiées par âge, si ce type en a (voir
    // BLD_AGE_SPRITE_FILES) : chargées à part, elles écrasent le repli
    // ci-dessus (même image à tous les âges) une fois prêtes — l'ordre entre
    // les deux n'a pas d'importance, chacune ne touche que ses propres clés.
    const ageFiles=BLD_AGE_SPRITE_FILES[type];
    if(ageFiles) for(const age in ageFiles){
      withIllustration('assets/batiments/'+ageFiles[age]+ASSET_EXT,TRIM_W_BLD,(url)=>{
        const cle=type+'_A'+age, cleE=cle+'_E';
        const meta=SPR.bld[cle]; if(!meta) return;
        const W=meta.c.width, H=meta.c.height;
        const fitted=fitBuildingImage(url,W,H); if(!fitted) return;
        SPR.bld[cle]=Object.assign({},meta,fitted);
        const metaE=SPR.bld[cleE];
        if(metaE) SPR.bld[cleE]=Object.assign({},metaE,tintEnemyBuilding(fitted,W,H));
      });
    }
  }
}

// Charge les illustrations par CIVILISATION (voir BLD_CIV_SPRITE_FILES),
// rangées dans SPR.bldCiv sous des clés « TC_byzantins » / « TC_byzantins_A2 »
// (+ leur variante « _E » teinte rouge) — même schéma de clé que lvlSuffix+suf
// dans drawBuildings, pour que sprTeinte() les retrouve sans code spécial.
// Indépendant de SPR.bld : tant qu'un fichier n'est pas prêt, drawBuildings
// retombe sur le sprite générique (illustré Francs ou procédural) — aucune
// régression possible, exactement le même principe que le reste de la
// surcouche illustrée.
function upgradeCivBuildingSprites(){
  for(const type in BLD_CIV_SPRITE_FILES){
    const ref=SPR.bld[type]; if(!ref) continue; // dimensions de référence
    const W=ref.c.width, H=ref.c.height;
    for(const civ in BLD_CIV_SPRITE_FILES[type]){
      const files=BLD_CIV_SPRITE_FILES[type][civ];
      for(const age in files){
        withIllustration('assets/batiments/'+files[age]+ASSET_EXT,TRIM_W_BLD,(url)=>{
          const fitted=fitBuildingImage(url,W,H); if(!fitted) return;
          const cle=type+'_'+civ+(age==='0'?'':'_A'+age);
          SPR.bldCiv[cle]=Object.assign({},ref,fitted);
          SPR.bldCiv[cle+'_E']=Object.assign({},ref,tintEnemyBuilding(fitted,W,H));
        });
      }
    }
  }
}

function drawBuildingSprite(cx,type,d,pw,ph,T,enemy,level,age,gateOpen){
  level=level||1; age=age||0;
  const oy=T*0.5;                 // marge haute du sprite
  const H=ph+oy;                  // bas du sprite
  const bodyTop=oy+ph*0.34;       // haut des murs
  const bodyH=H-bodyTop;
  const wallCol=enemy?'#7a3838':(d.col||'#9a7a4a');
  const wallLt =enemy?'#8f4444':lighten(wallCol,18);
  const wallDk =enemy?'#521f1f':darken(wallCol,22);
  const roofCol=enemy?'#9a2424':'#9a3a22';
  const roofLt =enemy?'#b83030':'#b8502c';
  const roofDk =enemy?'#641818':'#6a2614';
  const ec=(c)=>enemy?wallCol:c;  // teinte ennemie prioritaire

  const fill=(x,y,w,h,c)=>px(cx,Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c);
  const archD=(axc,ay,aw,ah,col)=>{ // ouverture en arche
    cx.fillStyle=col; cx.beginPath(); cx.arc(axc,ay+aw*0.5,aw/2,Math.PI,0); cx.fill();
    fill(axc-aw/2,ay+aw*0.5,aw,ah-aw*0.5,col);
  };
  const disc=(dx,dy,r,c)=>{ cx.fillStyle=c; cx.beginPath(); cx.arc(dx,dy,r,0,Math.PI*2); cx.fill(); };

  // ── corps de bâtiment standard ──
  // opts='stone' : blocs de pierre irréguliers (Tour/Château/Mine).
  // sinon : grain de bois (lisières verticales fines, façon rondins/planches).
  const body=(col,opts)=>{
    col=col||wallCol;
    fill(0,bodyTop,pw,bodyH,col);
    // bevel accentué : lisière claire à gauche, ombrée à droite et au pied
    fill(0,bodyTop,Math.max(2,pw*0.14),bodyH,lighten(col,22));
    fill(pw-Math.max(2,pw*0.14),bodyTop,Math.max(2,pw*0.14),bodyH,darken(col,26));
    fill(0,H-Math.max(3,ph*0.11),pw,Math.max(3,ph*0.11),darken(col,28));
    if(opts==='stone'){
      const rng=srnd(Math.round(pw*7+ph*13+1));
      const bw=Math.max(4,T*0.15), bh=Math.max(3,T*0.09);
      let row=0;
      for(let yy=bodyTop+bh;yy<H-bh*0.5;yy+=bh){
        const off=(row++%2)*bw*0.5;
        for(let xx=off;xx<pw-1;xx+=bw){
          const r=rng();
          if(r<0.5) fill(xx,yy,Math.max(1,bw*0.94),1,'rgba(0,0,0,.18)');       // joint de mortier
          if(r<0.3) fill(xx+1,yy-bh*0.55,bw*0.5,bh*0.4,lighten(col,10));       // reflet de bloc
          else if(r<0.42) fill(xx+bw*0.4,yy-bh*0.5,bw*0.4,bh*0.35,darken(col,14)); // bloc en creux
        }
      }
    } else {
      const rng=srnd(Math.round(pw*3+ph*5+1));
      for(let x2=pw*0.16;x2<pw*0.9;x2+=Math.max(4,pw*0.1)){
        if(rng()<0.75) fill(x2+rng()*2,bodyTop+2,1,bodyH-4,'rgba(0,0,0,.09)');
      }
    }
    for(let y=bodyTop+Math.max(3,T*0.18);y<H-3;y+=Math.max(4,T*0.2)) fill(2,y,pw-4,1,'rgba(0,0,0,.12)');
    fill(0,H-1,pw,1,'rgba(0,0,0,.35)'); // liseré sombre au pied, ancre le bâtiment au sol
  };
  const roofTri=(c1,c2,hf)=>{
    hf=hf||0.4;
    const rh=ph*hf, lines=Math.max(6,Math.round(rh));
    const c3=lighten(c1,16); // reflet de faîtage
    for(let k=0;k<lines;k++){
      const f=k/lines, w=pw*f;
      const col = k<lines*0.16 ? c3 : k<lines*0.52 ? c1 : c2;
      fill((pw-w)/2, oy+rh*f, w, rh/lines+1, col);
      if(k%3===0&&k>lines*0.16) fill((pw-w)/2, oy+rh*f, w, 1, 'rgba(0,0,0,.14)'); // rainure de tuile
    }
    fill(0,bodyTop-2,pw,2,roofDk);
    // brins de chaume à l'avant-toit : casse la ligne nette, lit "toit de paille" de près
    const rngT=srnd(Math.round(pw*11+ph*7+1));
    for(let x3=pw*0.06;x3<pw*0.94;x3+=Math.max(3,pw*0.05)) if(rngT()<0.6) fill(x3,bodyTop-Math.max(2,T*0.05),Math.max(1,pw*0.02),Math.max(2,T*0.07),roofDk);
    fill(pw/2-Math.max(1,pw*0.012),oy,Math.max(2,pw*0.024),rh*0.14,lighten(c1,28)); // faîtage éclairé
  };
  const crenel=()=>{
    fill(0,bodyTop-T*0.16,pw,T*0.16,roofDk);
    const n=Math.max(3,Math.round(pw/(T*0.5))), cw=pw/n;
    for(let k=0;k<n;k++) if(k%2===0) fill(k*cw,bodyTop-T*0.3,Math.ceil(cw),T*0.16,wallCol);
  };
  const flag=(fxc)=>{
    fill(fxc-T*0.025,oy-T*0.1,Math.max(3,T*0.05),T*0.5,'#caa83a');
    fill(fxc+T*0.025,oy-T*0.1,T*0.32,T*0.18,enemy?'#c0392b':'#2980b9');
  };
  const door=(wf)=>{
    const dw=Math.max(4,pw*(wf||0.18)), dh=Math.max(5,bodyH*0.5);
    fill(pw/2-dw/2,H-dh,dw,dh,'#33240f');
    fill(pw/2-dw/2,H-dh,dw,2,'#5a3c1c');
    for(let px2=pw/2-dw/2+dw*0.32;px2<pw/2+dw/2-1;px2+=dw*0.4) fill(px2,H-dh+2,Math.max(1,dw*0.06),dh-3,'rgba(0,0,0,.24)'); // planches verticales
    if(dw>Math.max(6,T*0.12)) fill(pw/2+dw*0.26,H-dh*0.44,Math.max(1,T*0.025),Math.max(1,T*0.025),'#d4a017'); // poignée
  };
  const windows=()=>{
    const fw=Math.max(2,pw*0.1), fy=bodyTop+bodyH*0.28;
    const lit=enemy?'#ffcc44':'#9fd8ff';
    for(const wx2 of [pw*0.2,pw*0.8-fw]){
      fill(wx2-fw*0.5,fy-1,fw*0.34,fw+2,wallDk);        // volet gauche
      fill(wx2+fw*1.16,fy-1,fw*0.34,fw+2,wallDk);       // volet droit
      fill(wx2-1,fy-1,fw+2,fw+2,'rgba(0,0,0,.32)'); // cadre
      fill(wx2,fy,fw,fw,lit);
      fill(wx2+fw*0.15,fy+fw*0.15,fw*0.35,fw*0.35,'#fff'); // reflet
      fill(wx2+fw*0.46,fy,Math.max(1,fw*0.08),fw,'rgba(0,0,0,.28)'); // croisillon
    }
  };

  fill(3,H-2,pw-2,3,'rgba(0,0,0,.28)'); // ombre portée

  switch(type){

  // ── FERME : un champ labouré, pas une bâtisse ──
  case BT.FARM: {
    // Champ cultivé : terre labourée + rangées de blé doré (fort contraste sur l'herbe)
    const soil  = enemy?'#5a4030':'#7a5432';
    const soilD = darken(soil,10);
    const wheat = enemy?'#8a7a40':'#d9b23c';
    const wheatL= enemy?'#a08f50':'#f0d060';
    const post  = ec('#6a4a26');
    const t2=Math.max(3,T*0.07);           // épaisseur de la clôture
    const x0=t2, y0=oy+ph*0.06, fw=pw-t2*2, fh=H-y0-t2;

    // terre nue
    fill(x0,y0,fw,fh,soil);
    // sillons horizontaux
    const rows=5, rh=fh/rows;
    for(let k=0;k<rows;k++){
      const y=y0+k*rh;
      fill(x0,y,fw,rh*0.5,soilD);                     // creux du sillon
      fill(x0,y+rh*0.5,fw,Math.max(1,rh*0.08),lighten(soil,8)); // crête éclairée
    }
    // épis de blé alignés sur les crêtes
    for(let k=0;k<rows;k++){
      const y=y0+k*rh+rh*0.12;
      for(let x=x0+fw*0.06;x<x0+fw*0.94;x+=fw*0.135){
        const sw=Math.max(2,fw*0.055), sh=Math.max(3,rh*0.42);
        fill(x,y,sw,sh,wheat);
        fill(x,y,sw*0.55,sh*0.5,wheatL);              // reflet
        fill(x+sw*0.2,y-sh*0.28,sw*0.6,sh*0.3,wheatL); // tête de l'épi
      }
    }
    // clôture de bois : montants + lisses
    fill(0,y0-t2,pw,t2,post); fill(0,H-t2,pw,t2,post);
    fill(0,y0-t2,t2,H-y0+t2,post); fill(pw-t2,y0-t2,t2,H-y0+t2,post);
    for(let x=0;x<pw;x+=Math.max(6,T*0.34)){
      fill(x,y0-t2*1.6,Math.max(2,t2*0.8),t2*1.9,lighten(post,12)); // piquets hauts
      fill(x,H-t2*1.4,Math.max(2,t2*0.8),t2*1.6,lighten(post,12));
    }
    break; }

  // ── MOULIN : ailes en X plaquées sur le pignon, pas un piquet planté
  // dans la porte. L'ancienne croix droite (bras full-hauteur non tournés)
  // traversait le corps du bâtiment jusqu'au sol et écrasait porte/fenêtres
  // — illisible comme moulin, lu comme une maison à l'échafaudage cassé.
  // Ailes tournées à 45°, ancrées haut sur le toit : la portée diagonale
  // reste courte verticalement, elle n'empiète plus sur la façade. ──
  case BT.MILL: {
    body(); roofTri(roofLt,roofCol,0.32); door(0.15); windows();
    const mx=pw/2, my=oy+ph*0.16, arm=Math.min(pw,ph)*0.34, tw=Math.max(2,T*0.045);
    const wood=ec('#6a4a24'), sail=ec('#e8d9b0');
    cx.save(); cx.translate(mx,my); cx.rotate(Math.PI/4);
    for(let k=0;k<4;k++){
      cx.save(); cx.rotate(k*Math.PI/2);
      // bras
      fill(-tw/2,0,tw,arm,wood);
      // toile triangulaire tendue sur le bras, effilée vers la pointe
      cx.fillStyle=sail;
      cx.beginPath();
      cx.moveTo(-tw*0.4,arm*0.16); cx.lineTo(tw*3.1,arm*0.3); cx.lineTo(-tw*0.4,arm*0.92);
      cx.closePath(); cx.fill();
      // lattis : 2 barreaux perpendiculaires, lisent "voile" plutôt que planche pleine
      fill(-tw*1.3,arm*0.42,tw*3.3,Math.max(1,tw*0.4),wood);
      fill(-tw*1.1,arm*0.68,tw*2.7,Math.max(1,tw*0.4),wood);
      cx.restore();
    }
    cx.restore();
    disc(mx,my,tw*1.35,'#3a2818');
    break; }

  // ── CAMP FORESTIER : abri ouvert + rondins ──
  case BT.LUMBER: {
    const pw2=Math.max(3,T*0.09);
    fill(pw*0.05,bodyTop,pw2,bodyH,'#4a3018');
    fill(pw-pw*0.05-pw2,bodyTop,pw2,bodyH,'#4a3018');
    roofTri(ec('#7a4a24'),ec('#5a3618'),0.36);
    const lr=Math.max(3,T*0.12);
    for(let r=0;r<2;r++) for(let k=0;k<3;k++){
      const lx=pw*0.22+k*lr*2+(r?lr:0), ly=H-lr*(r*1.7+1.1);
      disc(lx,ly,lr*0.95,'#8a5f30'); disc(lx,ly,lr*0.5,'#c8a070');
    }
    break; }

  // ── CAMP MINIER : galerie étayée + minerai ──
  case BT.MINE: {
    body(ec('#6a6a6a'),'stone');
    disc(pw*0.14,bodyTop+bodyH*0.32,T*0.12,ec('#8a8a92'));
    disc(pw*0.87,bodyTop+bodyH*0.26,T*0.1,ec('#8a8a92'));
    const ew=pw*0.32, eh=bodyH*0.72;
    archD(pw/2,H-eh,ew,eh,'#15151a');
    const bw=Math.max(3,T*0.07);
    fill(pw/2-ew/2-bw,H-eh,bw,eh,'#6a4a28');
    fill(pw/2+ew/2,H-eh,bw,eh,'#6a4a28');
    fill(pw/2-ew/2-bw,H-eh-bw,ew+bw*2,bw,'#6a4a28');
    fill(pw*0.07,H-T*0.16,T*0.13,T*0.11,'#d4a017');
    fill(pw*0.2,H-T*0.13,T*0.1,T*0.09,'#9a9aa2');
    break; }

  // ── MARCHÉ : auvent rayé + caisses ──
  case BT.MARKET: {
    body();
    const ah=ph*0.3, st=6, sw=pw/st;
    for(let k=0;k<st;k++){
      const c=k%2?'#e8e0d0':(enemy?'#a03030':'#c0392b');
      fill(k*sw,oy+ph*0.14,sw,ah,c);
      fill(k*sw,oy+ph*0.14+ah,sw*0.78,Math.max(2,T*0.06),c);
    }
    fill(pw*0.06,H-T*0.32,T*0.26,T*0.26,'#8a6a3a');
    fill(pw*0.06,H-T*0.32,T*0.26,Math.max(2,T*0.05),'#a88a5a');
    fill(pw*0.74,H-T*0.26,T*0.21,T*0.21,'#8a6a3a');
    fill(pw*0.74,H-T*0.26,T*0.21,Math.max(2,T*0.05),'#a88a5a');
    // tonneau + panier de marchandises entre les deux caisses : l'étal était
    // vide au centre, on ne lisait "commerce" qu'aux deux coins.
    disc(pw*0.42,H-T*0.18,T*0.12,'#6a4a28');
    fill(pw*0.42-T*0.12,H-T*0.24,T*0.24,Math.max(1,T*0.03),'#3a2818'); // cerclage
    fill(pw*0.42-T*0.12,H-T*0.1,T*0.24,Math.max(1,T*0.03),'#3a2818');
    const goodsCol=['#c0392b','#e8b030','#7ab840'];
    const goodsPos=[[0,0],[0.09,-0.02],[0.18,0],[0.045,-0.06],[0.135,-0.055]];
    for(let g=0;g<goodsPos.length;g++){
      const [dfx,dfy]=goodsPos[g];
      disc(pw*0.55+dfx*pw,H-T*0.08+dfy*T,T*0.045,goodsCol[g%goodsCol.length]);
    }
    break; }

  // ── FORGE : cheminée fumante + foyer incandescent + enclume ──
  case BT.FORGE: {
    body(ec('#484848')); roofTri(ec('#5a5a5a'),ec('#3a3a3a'),0.3);
    const chw=pw*0.19, chx=pw*0.7;
    fill(chx,oy-T*0.12,chw,ph*0.5,ec('#3a3a3a'));
    fill(chx,oy-T*0.12,chw,Math.max(3,T*0.07),ec('#5a5a5a'));
    cx.fillStyle='rgba(210,210,210,.32)';
    for(let k=0;k<3;k++){ cx.beginPath(); cx.arc(chx+chw/2+k*T*0.07,oy-T*0.2-k*T*0.11,T*0.08+k*T*0.025,0,Math.PI*2); cx.fill(); }
    const fw2=pw*0.32, fh=bodyH*0.44;
    fill(pw*0.1,H-fh-bodyH*0.14,fw2,fh,'#1a1008');
    fill(pw*0.12,H-fh-bodyH*0.11,fw2*0.85,fh*0.68,'#ff6a1a');
    fill(pw*0.15,H-fh-bodyH*0.06,fw2*0.55,fh*0.38,'#ffc14a');
    fill(pw*0.56,H-T*0.19,T*0.24,T*0.08,'#2a2a2a');
    fill(pw*0.62,H-T*0.12,T*0.1,T*0.09,'#2a2a2a');
    break; }

  // ── CASERNE : bannière + boucliers ──
  case BT.BARRACKS: {
    body(); roofTri(roofLt,roofCol,0.34); door(0.2);
    const bw2=pw*0.15;
    fill(pw*0.1,bodyTop+bodyH*0.08,bw2,bodyH*0.62,enemy?'#c0392b':'#2c5aa0');
    fill(pw*0.1,bodyTop+bodyH*0.08,bw2,Math.max(2,T*0.05),'#caa83a');
    for(const sx2 of [pw*0.74,pw*0.9]) {
      disc(sx2,bodyTop+bodyH*0.3,T*0.11,enemy?'#8a2a2a':'#b0b6bc');
      disc(sx2,bodyTop+bodyH*0.3,T*0.05,'#e8c84a');
    }
    // ── Habillage qui s'enrichit avec l'âge du propriétaire ──
    // Les trois paliers d'origine étaient là mais invisibles : mesurés, ils ne
    // changeaient que 0,9 % puis 0,7 % des pixels du sprite (contre 17 % à
    // 53 % pour le Mur, où la progression se voit vraiment). Un étendard collé
    // au bord droit et à moitié mangé par le biseau, un parapet de trois
    // pixels de haut, un râtelier filiforme : au format de jeu, les quatre
    // Casernes étaient rigoureusement identiques. Chaque palier change
    // désormais la SILHOUETTE ou une grande surface.
    if(age>=1){ // Âge Féodal : second étendard + auvent de bois sur l'entrée
      fill(pw*0.75,bodyTop+bodyH*0.08,bw2,bodyH*0.62,enemy?'#c0392b':'#2c5aa0');
      fill(pw*0.75,bodyTop+bodyH*0.08,bw2,Math.max(2,T*0.05),'#caa83a');
      const aw=pw*0.46, ay=bodyTop+bodyH*0.42;
      fill(pw/2-aw/2,ay,aw,Math.max(3,T*0.09),'#6a4a24');                       // toit d'auvent
      fill(pw/2-aw/2,ay,aw,Math.max(1,T*0.03),'#8a6438');
      fill(pw/2-aw/2,ay,Math.max(2,T*0.045),bodyH*0.4,'#5a3c1c');               // poteaux
      fill(pw/2+aw/2-Math.max(2,T*0.045),ay,Math.max(2,T*0.045),bodyH*0.4,'#5a3c1c');
    }
    if(age>=2){ // Âge des Châteaux : soubassement de pierre + vrai parapet crénelé
      const stc=enemy?'#7a6a68':'#9a968c', stcDk=darken(stc,26);
      fill(0,H-bodyH*0.34,pw,bodyH*0.34,stc);
      fill(0,H-bodyH*0.34,pw,Math.max(2,T*0.04),lighten(stc,16));
      const bwS=Math.max(4,T*0.2), bhS=Math.max(3,T*0.12);
      let rowS=0;
      for(let yy=H-bodyH*0.34+bhS;yy<H;yy+=bhS){
        const offS=(rowS++%2)*bwS*0.5;
        for(let xx=offS;xx<pw-1;xx+=bwS) fill(xx,yy,Math.max(1,bwS*0.9),1,'rgba(0,0,0,.22)');
      }
      fill(0,H-Math.max(3,T*0.06),pw,Math.max(3,T*0.06),stcDk);
      const mw=pw/7;                                                            // parapet, deux fois plus haut
      fill(0,bodyTop-T*0.10,pw,T*0.10,stcDk);
      for(let k=0;k<7;k++) if(k%2===0) fill(k*mw,bodyTop-T*0.26,Math.ceil(mw),T*0.17,stc);
    }
    if(age>=3){ // Âge Impérial : faîtage doré, oriflamme au sommet, râtelier garni
      fill(0,bodyTop-T*0.30,pw,Math.max(2,T*0.045),'#caa83a');
      fill(pw/2-Math.max(2,T*0.035),oy-T*0.16,Math.max(3,T*0.07),T*0.5,'#caa83a');  // hampe
      fill(pw/2,oy-T*0.16,T*0.34,T*0.2,enemy?'#8b1a1a':'#2980b9');                  // oriflamme
      fill(pw/2,oy-T*0.16,T*0.34,Math.max(1,T*0.035),'#e8c84a');
      const rky=H-bodyH*0.5;                                                        // râtelier : 4 lances + bouclier
      fill(pw*0.34,rky+bodyH*0.3,pw*0.32,Math.max(2,T*0.045),'#6a4a24');
      for(let k=0;k<4;k++) fill(pw*0.36+k*pw*0.08,rky,Math.max(2,T*0.03),bodyH*0.32,'#cfcfd6');
      for(let k=0;k<4;k++) fill(pw*0.355+k*pw*0.08,rky,Math.max(2,T*0.045),Math.max(2,T*0.05),'#e8e8ee');
      disc(pw*0.22,rky+bodyH*0.16,T*0.13,'#caa83a');
      disc(pw*0.22,rky+bodyH*0.16,T*0.06,enemy?'#8b1a1a':'#2980b9');
    }
    break; }

  // ── ÉCURIE : large porche + foin ──
  case BT.STABLE: {
    body(); roofTri(ec('#a06a3a'),ec('#7a4a24'),0.34);
    const ow=pw*0.36, oh=bodyH*0.64;
    archD(pw/2,H-oh,ow,oh,'#2a1c0c');
    fill(pw/2-ow/2,H-oh*0.5,ow,Math.max(2,T*0.06),'#8a6a3a');
    fill(pw/2-ow/2,H-oh*0.24,ow,Math.max(2,T*0.06),'#8a6a3a');
    fill(pw*0.06,H-T*0.23,T*0.23,T*0.19,'#d8b048');
    fill(pw*0.06,H-T*0.23,T*0.23,Math.max(2,T*0.04),'#e8c868');
    break; }

  // ── MONASTÈRE : croix + vitrail ──
  case BT.MONASTERY: {
    body(ec('#c9b99a')); roofTri(ec('#8b7355'),ec('#6a5540'),0.3);
    const cw2=Math.max(3,T*0.055);
    fill(pw/2-cw2/2,oy-T*0.24,cw2,T*0.32,'#caa83a');
    fill(pw/2-T*0.1,oy-T*0.15,T*0.2,cw2,'#caa83a');
    const aw=pw*0.32;
    archD(pw/2,bodyTop+bodyH*0.2,aw,bodyH*0.42,'#3a2f22');
    fill(pw/2-aw*0.11,bodyTop+bodyH*0.24,aw*0.22,bodyH*0.3,enemy?'#ffcc44':'#9fd8ff');
    door(0.2);
    break; }

  // ── UNIVERSITÉ : dôme + hautes arches ──
  case BT.UNIV: {
    body(ec('#2c6e8a'));
    cx.fillStyle=ec('#3a8aa8'); cx.beginPath(); cx.arc(pw/2,bodyTop,pw*0.3,Math.PI,0); cx.fill();
    cx.fillStyle=ec('#5aa8c8'); cx.beginPath(); cx.arc(pw*0.43,bodyTop-pw*0.05,pw*0.13,Math.PI,0); cx.fill();
    fill(pw/2-Math.max(2,T*0.035),bodyTop-pw*0.3-T*0.2,Math.max(3,T*0.07),T*0.22,'#caa83a');
    // sphère armillaire au sommet, pas juste une pointe dorée : le dôme
    // seul se lisait "mosquée/observatoire" plutôt que "savoir" — l'anneau
    // incliné façon astrolabe ancre le thème universitaire au premier regard.
    const armY=bodyTop-pw*0.3-T*0.22;
    disc(pw/2,armY,T*0.045,'#e8c84a');
    cx.strokeStyle='#caa83a'; cx.lineWidth=Math.max(1,T*0.02);
    cx.beginPath(); cx.ellipse(pw/2,armY,T*0.1,T*0.04,0.5,0,Math.PI*2); cx.stroke();
    cx.beginPath(); cx.ellipse(pw/2,armY,T*0.1,T*0.04,-0.5,0,Math.PI*2); cx.stroke();
    for(const fx of [pw*0.17,pw*0.83]){
      const aw2=pw*0.16;
      archD(fx,bodyTop+bodyH*0.22,aw2,bodyH*0.52,'#173a4a');
      fill(fx-aw2*0.13,bodyTop+bodyH*0.28,aw2*0.26,bodyH*0.34,enemy?'#ffcc44':'#7fc8e8');
    }
    door(0.18);
    // livre ouvert posé au pied de l'entrée : détail domestique du savoir,
    // même principe que la jardinière de la maison ou le tonneau du quai.
    const bkw=T*0.16, bkx=pw*0.5-bkw*1.1, bky=H-T*0.07;
    fill(bkx,bky,bkw,Math.max(2,T*0.045),'#e8ddc0');
    fill(bkx,bky,bkw*0.48,Math.max(2,T*0.045),'#d8cca8');
    fill(bkx+bkw*0.48,bky-1,Math.max(1,T*0.012),Math.max(3,T*0.05),'#8a6a3a'); // reliure centrale
    break; }

  // ── TOUR : meurtrières + créneaux (+ habillage selon le niveau) ──
  case BT.TOWER: {
    body(undefined,'stone'); crenel();
    for(const my2 of [bodyTop+bodyH*0.22,bodyTop+bodyH*0.52]){
      fill(pw/2-Math.max(2,T*0.04),my2,Math.max(3,T*0.08),bodyH*0.17,'#241f14');
    }
    door(0.26);
    if(level>=2) flag(pw/2);                        // Tour de Garde : bannière
    if(level>=3){                                     // Donjon : bande de créneaux renforcés, cerclée de fer
      const bh2=T*0.15, steelDk=enemy?'#3a1414':'#3a3a42', steelLt=enemy?'#9a4040':'#9a9aa4';
      fill(0,bodyTop-T*0.16-bh2,pw,bh2,steelDk);
      const n3=Math.max(3,Math.round(pw/(T*0.5))), cw3=pw/n3;
      for(let k=0;k<n3;k++) if(k%2===0) fill(k*cw3,bodyTop-T*0.3-bh2,Math.ceil(cw3),bh2,steelLt);
      fill(0,bodyTop-T*0.16,pw,Math.max(1,T*0.025),steelLt); // liseré métallique sous les créneaux d'origine
    }
    break; }

  // ── CHÂTEAU : tourelles d'angle + herse ──
  case BT.CASTLE: {
    body(undefined,'stone'); crenel();
    const tw2=pw*0.19;
    for(const tx2 of [0,pw-tw2]){
      fill(tx2,bodyTop-T*0.4,tw2,bodyH+T*0.4,wallLt);
      fill(tx2,bodyTop-T*0.4,tw2,T*0.1,roofDk);
      for(let k=0;k<3;k++) fill(tx2+k*tw2/3,bodyTop-T*0.52,tw2/3*0.72,T*0.13,wallCol);
    }
    flag(pw/2);
    const gw=pw*0.22, gh=bodyH*0.58;
    archD(pw/2,H-gh,gw,gh,'#2a1c0c');
    for(let k=1;k<4;k++) fill(pw/2-gw/2,H-gh*k/4,gw,Math.max(1,T*0.03),'#6a5a3a');
    break; }

  // ── CENTRE VILLE : grande arche + bannière ──
  case BT.TC: {
    body(); crenel(); flag(pw/2);
    const gw2=pw*0.26, gh2=bodyH*0.6;
    archD(pw/2,H-gh2,gw2,gh2,'#2a1c0c');
    windows();
    // habillage qui s'enrichit avec l'âge du joueur (voir buildBuildings)
    if(age>=1){ // Âge Féodal : soubassement de pierre
      fill(0,H-bodyH*0.22,pw,bodyH*0.22,darken(wallCol,8));
      const rng=srnd(11);
      for(let x=2;x<pw-2;x+=T*0.12) if(rng()<0.6) fill(x,H-bodyH*0.2,T*0.06,1,'rgba(0,0,0,.2)');
    }
    if(age>=2){ // Âge des Châteaux : tourelles d'angle
      const tw2=pw*0.12;
      for(const tx2 of [0,pw-tw2]){
        fill(tx2,bodyTop-T*0.22,tw2,bodyH+T*0.22,wallLt);
        fill(tx2,bodyTop-T*0.22,tw2,T*0.08,roofDk);
      }
    }
    if(age>=3){
      // Âge Impérial. Le palier se limitait à un liseré de 2 px et deux
      // fanions : 4 % de pixels changés, invisible en jeu alors que c'est
      // l'aboutissement de toute une partie. On ajoute une grande tenture
      // armoriée sur la façade et des merlons dorés — deux grandes surfaces,
      // donc lisibles d'un coup d'œil sur la carte.
      fill(0,bodyTop-2,pw,Math.max(2,T*0.05),'#caa83a');
      const n4=Math.max(3,Math.round(pw/(T*0.5))), cw4=pw/n4;
      for(let k=0;k<n4;k++) if(k%2===0) fill(k*cw4,bodyTop-T*0.3,Math.ceil(cw4),Math.max(2,T*0.05),'#caa83a');
      const tw4=pw*0.2, ty4=bodyTop+T*0.06;
      for(const tx4 of [pw*0.3-tw4/2,pw*0.7-tw4/2]){
        fill(tx4,ty4,tw4,bodyH*0.42,enemy?'#8b1a1a':'#2c5aa0');
        fill(tx4,ty4,tw4,Math.max(2,T*0.04),'#caa83a');
        fill(tx4,ty4+bodyH*0.42,tw4/2,Math.max(3,T*0.07),enemy?'#8b1a1a':'#2c5aa0'); // pointe de tenture
        disc(tx4+tw4/2,ty4+bodyH*0.2,T*0.09,'#caa83a');
      }
      flag(pw*0.16); flag(pw*0.84);
    }
    break; }

  // ── ATELIER DE SIÈGE : auvent ouvert + bélier en construction ──
  // Les deux roues posées côte à côte, sans rien qui les relie, se lisaient
  // comme un box de rangement plutôt qu'un engin en cours de montage. On
  // suspend maintenant le tronc du bélier ENTRE les deux roues par des
  // chaînes (comme sur son affût fini) et on lui donne une vraie tête de
  // fer conique en bout — la silhouette se lit "bélier" d'un coup d'œil. ──
  case BT.SIEGE: {
    const pw2=Math.max(3,T*0.09);
    fill(pw*0.05,bodyTop,pw2,bodyH,'#4a3018');
    fill(pw-pw*0.05-pw2,bodyTop,pw2,bodyH,'#4a3018');
    roofTri(ec('#7a6a4a'),ec('#5a4a30'),0.3);
    // affût : deux roues cerclées de fer, posture d'essieu (même hauteur, écartées)
    const wr=Math.max(4,T*0.15), wy=H-wr*1.05;
    const wx1=pw*0.22, wx2=pw*0.66;
    for(const wcx of [wx1,wx2]){
      disc(wcx,wy,wr,'#3a2818'); disc(wcx,wy,wr*0.78,'#4a3220');
      disc(wcx,wy,wr*0.22,'#8a8a92'); // moyeu métallique
      for(let a=0;a<6;a++){ const ang=a*Math.PI/3; fill(wcx+Math.cos(ang)*wr*0.15,wy+Math.sin(ang)*wr*0.15,Math.max(1,wr*0.12),wr*0.85,'#2a1c10'); } // rayons
    }
    // chaînes de suspension : le tronc pend entre les deux roues, pas posé au sol
    const beamY=wy-wr*1.5;
    cx.strokeStyle='#5a5a5a'; cx.lineWidth=Math.max(1,T*0.02);
    cx.beginPath(); cx.moveTo(wx1,wy-wr*0.6); cx.lineTo(wx1,beamY); cx.stroke();
    cx.beginPath(); cx.moveTo(wx2,wy-wr*0.6); cx.lineTo(wx2,beamY); cx.stroke();
    // tronc du bélier, effilé vers la tête de fer conique en bout
    fill(wx1-wr*0.3,beamY-Math.max(2,T*0.05),(wx2-wx1)+wr*0.3,Math.max(3,T*0.09),'#6a4a28');
    fill(wx1-wr*0.3,beamY-Math.max(2,T*0.05),(wx2-wx1)+wr*0.3,Math.max(1,T*0.025),'#8a6a44'); // reflet du bois
    cx.fillStyle='#9a9aa2';
    cx.beginPath();
    cx.moveTo(wx2+wr*0.15,beamY-Math.max(2,T*0.06)); cx.lineTo(wx2+wr*0.65,beamY-Math.max(1,T*0.02));
    cx.lineTo(wx2+wr*0.15,beamY+Math.max(2,T*0.06)); cx.closePath(); cx.fill(); // tête conique
    break; }

  // ── AVANT-POSTE : petite palissade + brasero de guet ──
  // ── AVANT-POSTE : échafaudage + plateforme de guet + brasier de signal ──
  // Trois poteaux verticaux, une traverse et une pastille orange : ça se
  // lisait comme une cage de but avec un ballon. Un avant-poste sert à VOIR
  // loin — la silhouette doit donc raconter un poste surélevé : jambes de
  // bois écartées vers le bas (contreventement), plancher de guet nettement
  // marqué, garde-corps ajouré et feu de signal posé DESSUS, pas au milieu.
  case BT.OUTPOST: {
    const bois=ec('#7a5a34'), boisDk=ec('#4a3218'), boisLt=ec('#9a7448');
    const pw2=Math.max(2,T*0.055);
    const plancher=bodyTop+bodyH*0.30;
    // pieds évasés : deux montants qui s'écartent vers le sol
    cx.save();
    cx.strokeStyle=bois; cx.lineWidth=pw2; cx.lineCap='butt';
    cx.beginPath();
    cx.moveTo(pw*0.24,plancher); cx.lineTo(pw*0.10,H);
    cx.moveTo(pw*0.76,plancher); cx.lineTo(pw*0.90,H);
    cx.moveTo(pw*0.40,plancher); cx.lineTo(pw*0.36,H);
    cx.moveTo(pw*0.60,plancher); cx.lineTo(pw*0.64,H);
    cx.stroke();
    // croix de Saint-André : c'est ce détail qui dit « échafaudage »
    cx.strokeStyle=boisDk; cx.lineWidth=Math.max(1.5,T*0.035);
    cx.beginPath();
    cx.moveTo(pw*0.16,H-bodyH*0.06); cx.lineTo(pw*0.84,plancher+bodyH*0.12);
    cx.moveTo(pw*0.84,H-bodyH*0.06); cx.lineTo(pw*0.16,plancher+bodyH*0.12);
    cx.stroke();
    cx.restore();
    // plancher de guet
    fill(pw*0.06,plancher,pw*0.88,Math.max(3,T*0.085),bois);
    fill(pw*0.06,plancher,pw*0.88,Math.max(1,T*0.03),boisLt);
    fill(pw*0.06,plancher+Math.max(3,T*0.085),pw*0.88,Math.max(1,T*0.025),boisDk);
    // garde-corps ajouré
    fill(pw*0.10,plancher-T*0.16,Math.max(2,T*0.045),T*0.16,bois);
    fill(pw*0.86,plancher-T*0.16,Math.max(2,T*0.045),T*0.16,bois);
    fill(pw*0.10,plancher-T*0.16,pw*0.80,Math.max(2,T*0.04),boisLt);
    // brasier de signal, posé SUR la plateforme
    const bx=pw*0.5, by=plancher-T*0.30;
    fill(bx-Math.max(2,T*0.075),by+T*0.14,Math.max(3,T*0.15),Math.max(2,T*0.05),'#2e2418'); // trépied
    fill(bx-Math.max(2,T*0.09),by+T*0.06,Math.max(4,T*0.18),T*0.10,'#3a2c1c');              // vasque
    fill(bx-Math.max(2,T*0.09),by+T*0.06,Math.max(4,T*0.18),Math.max(1,T*0.025),'#5a4830');
    cx.fillStyle='rgba(255,120,30,.9)';
    cx.beginPath(); cx.arc(bx,by+T*0.02,T*0.085,0,Math.PI*2); cx.fill();
    cx.fillStyle='rgba(255,190,90,.95)';
    cx.beginPath(); cx.arc(bx,by-T*0.02,T*0.05,0,Math.PI*2); cx.fill();
    cx.fillStyle='rgba(255,240,190,.9)';
    cx.beginPath(); cx.arc(bx,by-T*0.05,T*0.025,0,Math.PI*2); cx.fill();
    break; }

  // ── PORTAIL : montants de pierre + vantail de bois, ouvert ou fermé ──
  case BT.GATE: {
    const postW=Math.max(4,pw*0.16), postCol=ec('#6a6a6a');
    // montants de pierre ancrés au sol, façon jambages de mur
    fill(0,bodyTop-T*0.16,postW,bodyH+T*0.16,postCol);
    fill(pw-postW,bodyTop-T*0.16,postW,bodyH+T*0.16,postCol);
    fill(0,bodyTop-T*0.16,postW,Math.max(2,T*0.05),lighten(postCol,14));
    fill(pw-postW,bodyTop-T*0.16,postW,Math.max(2,T*0.05),lighten(postCol,14));
    // linteau de pierre au-dessus du passage
    fill(0,bodyTop-T*0.24,pw,T*0.1,darken(postCol,10));
    if(gateOpen){
      // vantail rabattu contre le montant droit : passage libre, on voit le sol
      const leafW=Math.max(3,pw*0.14);
      fill(pw-postW-leafW,bodyTop-T*0.02,leafW,bodyH*0.9,ec('#8a5a2a'));
      for(let yy=bodyTop+bodyH*0.1;yy<H-bodyH*0.1;yy+=Math.max(3,T*0.16)) fill(pw-postW-leafW+1,yy,leafW-2,Math.max(1,T*0.03),'rgba(0,0,0,.18)');
      // fond visible entre les montants : le passage est réellement dégagé
      fill(postW,bodyTop+bodyH*0.1,pw-postW*2-leafW,bodyH*0.85,'rgba(20,15,8,.22)');
    } else {
      // vantail fermé : planches verticales cerclées de fer, barre le passage
      const gw=pw-postW*2;
      fill(postW,bodyTop-T*0.02,gw,bodyH*0.92,ec('#8a5a2a'));
      for(let x=postW+gw*0.14;x<pw-postW;x+=gw*0.22) fill(x,bodyTop+2,Math.max(1,gw*0.03),bodyH*0.88,'rgba(0,0,0,.2)');
      fill(postW,bodyTop+bodyH*0.22,gw,Math.max(2,T*0.05),'#3a3a3a'); // cerclage de fer
      fill(postW,bodyTop+bodyH*0.62,gw,Math.max(2,T*0.05),'#3a3a3a');
      disc(pw/2,bodyTop+bodyH*0.42,Math.max(2,T*0.045),'#caa83a'); // targette dorée
    }
    break; }

  // ── MUR : palissade de bois (Âge Sombre) → pierre → fortifié (Impérial) ──
  // Pas de palier payant séparé : le PV suit déjà le bonus d'âge générique
  // (voir updateAgeUp) ; ici seul l'habillage visuel change, pour que la
  // montée en âge se VOIE sur les remparts et pas seulement dans les PV.
  case BT.WALL: {
    const stoneCol=ec('#8a8a92'), stoneDk=darken(stoneCol,24), stoneLt=lighten(stoneCol,16);
    const woodPosts=(topY)=>{
      const n2=Math.max(3,Math.round(pw/(T*0.3))), lw2=pw/n2;
      for(let k=0;k<n2;k++){
        const x=k*lw2;
        fill(x,topY,lw2*0.92,H-topY, k%2?wallCol:lighten(wallCol,10));
        fill(x+lw2*0.18,topY-T*0.1,lw2*0.56,T*0.11,lighten(wallCol,16));
      }
    };
    if(age>=2){
      // Mur de Pierre (Châteaux) / Fortifié (Impérial) : blocs pleins
      fill(0,bodyTop-T*0.06,pw,bodyH+T*0.06,stoneCol);
      fill(0,bodyTop-T*0.06,pw,Math.max(2,T*0.05),lighten(stoneCol,18));
      fill(0,H-Math.max(3,bodyH*0.12),pw,Math.max(3,bodyH*0.12),stoneDk);
      const rng=srnd(Math.round(pw*7+bodyH*5+1));
      const bw=Math.max(4,T*0.22), bh=Math.max(3,T*0.13);
      let row=0;
      for(let yy=bodyTop+bh*0.4;yy<H-bh*0.3;yy+=bh){
        const off=(row++%2)*bw*0.5;
        for(let xx=off;xx<pw-1;xx+=bw){
          fill(xx,yy,Math.max(1,bw*0.9),1,'rgba(0,0,0,.22)');           // joint horizontal
          if(rng()<0.4) fill(xx+bw*0.15,yy-bh*0.5,bw*0.3,bh*0.35,stoneLt); // reflet de bloc
        }
      }
      for(let xx=0;xx<pw;xx+=bw) fill(xx,bodyTop-T*0.02,Math.max(1,T*0.02),bodyH+T*0.06,'rgba(0,0,0,.14)'); // joints verticaux
      if(age>=3){
        // Mur Fortifié : créneaux + liseré doré impérial
        const n3=Math.max(2,Math.round(pw/(T*0.4))), cw3=pw/n3;
        fill(0,bodyTop-T*0.18,pw,T*0.14,stoneDk);
        for(let k=0;k<n3;k++) if(k%2===0) fill(k*cw3,bodyTop-T*0.3,Math.ceil(cw3),T*0.16,stoneCol);
        fill(0,bodyTop-T*0.06,pw,Math.max(1,T*0.02),'#caa83a');
      }
    } else if(age>=1){
      // Palissade renforcée (Féodal) : socle de pierre + rondins au-dessus
      const baseH=bodyH*0.26;
      fill(0,H-baseH,pw,baseH,stoneDk);
      fill(0,H-baseH,pw,Math.max(1,T*0.03),lighten(stoneDk,14));
      woodPosts(bodyTop-T*0.16);
      fill(0,H-baseH,pw,baseH,stoneDk); // repasse le socle par-dessus le pied des rondins
      fill(0,H-baseH,pw,Math.max(1,T*0.03),lighten(stoneDk,14));
    } else {
      // Palissade (Âge Sombre) : rondins pointus
      woodPosts(bodyTop-T*0.16);
      fill(0,bodyTop+bodyH*0.28,pw,Math.max(2,T*0.07),darken(wallCol,25));
      fill(0,bodyTop+bodyH*0.72,pw,Math.max(2,T*0.07),darken(wallCol,25));
    }
    break; }

  // ── IMMEUBLE HLM : bloc de béton, façade en grille de fenêtres, toit plat +
  // château d'eau — anachronisme assumé au milieu du village médiéval : la
  // silhouette doit détonner d'un coup d'œil face aux maisons de bois. ──
  case BT.HLM: {
    const concrete=ec('#8a8f96'), concreteDk=darken(concrete,22), concreteLt=lighten(concrete,14);
    // déborde dans la marge de toit (oy) : pas de toit pointu, juste deux
    // étages de façade en plus, pour paraître plus haut qu'une maison.
    const topY=oy*0.12;
    fill(0,topY,pw,H-topY,concrete);
    fill(0,topY,Math.max(2,pw*0.08),H-topY,concreteLt);              // biseau clair à gauche
    fill(pw-Math.max(2,pw*0.08),topY,Math.max(2,pw*0.08),H-topY,concreteDk); // biseau sombre à droite
    fill(0,topY,pw,Math.max(2,T*0.05),lighten(concrete,20));         // liseré de toit plat
    fill(0,H-Math.max(3,T*0.08),pw,Math.max(3,T*0.08),concreteDk);   // pied ombré
    // grille de fenêtres sur plusieurs étages
    const cols4=3, rows4=5;
    const cellW=pw/cols4, cellH=(H-topY-T*0.14)/rows4;
    const fw=cellW*0.6, fh=cellH*0.55;
    const lit=enemy?'#ffcc44':'#9fd8ff';
    for(let r=0;r<rows4;r++){
      const fy=topY+T*0.08+r*cellH;
      for(let c=0;c<cols4;c++){
        const fx=c*cellW+(cellW-fw)/2;
        fill(fx-1,fy-1,fw+2,fh+2,'rgba(0,0,0,.32)');                 // cadre
        fill(fx,fy,fw,fh,lit);
        fill(fx+fw*0.12,fy+fh*0.12,fw*0.32,fh*0.3,'#fff');           // reflet
        fill(fx+fw*0.46,fy,Math.max(1,fw*0.08),fh,'rgba(0,0,0,.25)');// croisillon
        if(r%2===1) fill(fx-fw*0.15,fy+fh+Math.max(1,T*0.02),fw*1.3,Math.max(2,T*0.035),concreteDk); // balconnet
      }
    }
    door(0.24);
    // château d'eau sur le toit : détail signature, lisible même de loin
    const tankW=pw*0.16, tankH=T*0.18;
    fill(pw*0.5-tankW/2,topY-tankH,tankW,tankH,concreteDk);
    fill(pw*0.5-tankW*0.5,topY-tankH,tankW,Math.max(1,T*0.03),concreteLt);
    fill(pw*0.5-Math.max(1,T*0.02),topY-tankH-T*0.06,Math.max(2,T*0.04),T*0.06,concreteDk); // pied du réservoir
    break; }

  // ── MERVEILLE : perron à degrés, colonnade, tourelles et dôme doré ──
  // (jusqu'ici sans case dédiée : elle retombait sur `default`, la maison
  // générique — invisible sur la carte pour LE bâtiment cense être le plus
  // impressionnant du jeu. cf. BDEF[BT.WONDER].)
  case BT.WONDER: {
    const domeCol=ec('#e8d49a'), domeLt=ec('#f5e8c0'), domeDk=ec('#b89850');
    body(undefined,'stone');
    // perron : degrés qui élargissent la base, ancrent la Merveille au sol
    fill(-pw*0.03,H-Math.max(3,ph*0.05),pw*1.06,Math.max(3,ph*0.05),darken(wallCol,10));
    fill(-pw*0.05,H-Math.max(2,ph*0.025),pw*1.1,Math.max(2,ph*0.025),darken(wallCol,18));
    // colonnade en façade
    const nCol=6, colW=Math.max(2,T*0.06);
    for(let k=0;k<nCol;k++){
      const cxp=pw*0.12+k*(pw*0.76/(nCol-1));
      fill(cxp-colW/2,bodyTop+bodyH*0.1,colW,bodyH*0.7,domeLt);
      fill(cxp-colW/2,bodyTop+bodyH*0.1,colW,Math.max(1,T*0.03),domeDk);   // chapiteau
      fill(cxp-colW/2,H-bodyH*0.16,colW,Math.max(1,T*0.03),domeDk);       // base
    }
    // tourelles d'angle à petit dôme
    const tw4=pw*0.16;
    for(const txp of [0,pw-tw4]){
      fill(txp,bodyTop-T*0.3,tw4,bodyH+T*0.3,wallLt);
      cx.fillStyle=domeCol; cx.beginPath(); cx.arc(txp+tw4/2,bodyTop-T*0.3,tw4*0.55,Math.PI,0); cx.fill();
      cx.fillStyle=domeLt; cx.beginPath(); cx.arc(txp+tw4*0.36,bodyTop-T*0.42,tw4*0.22,Math.PI,0); cx.fill();
      fill(txp+tw4/2-Math.max(1,T*0.02),bodyTop-T*0.54,Math.max(2,T*0.03),T*0.16,'#caa83a');
    }
    // dôme central, large, avec hampe et pommeau doré
    cx.fillStyle=domeCol; cx.beginPath(); cx.arc(pw/2,bodyTop-T*0.05,pw*0.26,Math.PI,0); cx.fill();
    cx.fillStyle=domeLt; cx.beginPath(); cx.arc(pw*0.42,bodyTop-T*0.16,pw*0.12,Math.PI,0); cx.fill();
    fill(pw/2-Math.max(2,T*0.035),bodyTop-pw*0.26-T*0.26,Math.max(3,T*0.06),T*0.24,'#caa83a');
    disc(pw/2,bodyTop-pw*0.26-T*0.28,Math.max(2,T*0.04),'#f5e070');
    // arche d'entrée monumentale, linteau doré
    const gw3=pw*0.22, gh3=bodyH*0.6;
    archD(pw/2,H-gh3,gw3,gh3,'#2a1c0c');
    fill(pw/2-gw3*0.7,H-gh3-Math.max(2,T*0.04),gw3*1.4,Math.max(2,T*0.04),'#caa83a');
    break; }

  // ── QUAI : entrepôt de bois + ponton sur pilotis, tonneaux et cordages ──
  // (autre bâtiment jusqu'ici sans case dédiée, invisible en tant que Quai.)
  case BT.DOCK: {
    body(); roofTri(ec('#7a5a38'),ec('#4a3220'),0.3); door(0.2);
    const plankCol=ec('#8a6a44'), plankLt=ec('#a8845a'), plankDk=ec('#5a4028');
    // ponton en avant-plan, planches horizontales : occupe le bas du
    // bâtiment jusqu'à H (un fill qui déborderait sous H serait rogné par
    // le canvas hors-écran, qui s'arrête pile à H — d'où dy2=H-dh2, pas H).
    const dh2=bodyH*0.3, dy2=H-dh2;
    fill(-pw*0.04,dy2,pw*1.08,dh2,plankCol);
    fill(-pw*0.04,dy2,pw*1.08,Math.max(1,T*0.02),plankLt);              // reflet du bord
    for(let x4=pw*0.02;x4<pw*0.98;x4+=Math.max(3,T*0.09)) fill(x4,dy2,Math.max(1,T*0.015),dh2,plankDk);
    // tonneau posé sur le ponton
    disc(pw*0.16,dy2+dh2*0.32,Math.max(3,T*0.09),'#6a4a28');
    fill(pw*0.16-T*0.09,dy2+dh2*0.18,T*0.18,Math.max(1,T*0.02),'#3a2818');
    // cordage enroulé
    cx.strokeStyle='rgba(90,60,30,.85)'; cx.lineWidth=Math.max(1,T*0.02);
    cx.beginPath(); cx.arc(pw*0.84,dy2+dh2*0.35,Math.max(3,T*0.07),0,Math.PI*1.6); cx.stroke();
    // mât et pavillon
    fill(pw*0.88,oy-T*0.1,Math.max(1,T*0.02),ph*0.5,'#4a3420');
    fill(pw*0.88+Math.max(1,T*0.02),oy-T*0.1,T*0.22,T*0.14,enemy?'#c0392b':'#2980b9');
    // bollard d'amarrage en bord de ponton : ancre le bâtiment à l'eau qui
    // le borde plutôt que de le laisser lire comme un simple entrepôt.
    disc(pw*0.44,dy2-Math.max(1,T*0.02),Math.max(2,T*0.045),'#2a1c10');
    fill(pw*0.44-Math.max(1,T*0.02),dy2-T*0.14,Math.max(2,T*0.04),T*0.14,'#3a2818');
    // filet de pêche suspendu au mur : treillis de corde en losanges,
    // motif nautique qu'aucun autre bâtiment ne porte.
    const nx=pw*0.36, ny=bodyTop+bodyH*0.14, nw=pw*0.26, nh=bodyH*0.32;
    cx.save();
    cx.beginPath(); cx.rect(nx,ny,nw,nh); cx.clip();
    cx.strokeStyle='rgba(90,65,35,.65)'; cx.lineWidth=Math.max(1,T*0.013);
    const step=Math.max(3,T*0.09);
    for(let d=-nh;d<nw+nh;d+=step){
      cx.beginPath(); cx.moveTo(nx+d,ny); cx.lineTo(nx+d-nh,ny+nh); cx.stroke();
      cx.beginPath(); cx.moveTo(nx+d,ny); cx.lineTo(nx+d+nh,ny+nh); cx.stroke();
    }
    cx.restore();
    fill(nx-Math.max(1,T*0.02),ny-Math.max(1,T*0.02),nw+Math.max(2,T*0.04),Math.max(1,T*0.025),'#5a4028'); // tringle de suspension
    break; }

  // ── MAISON et par défaut : toit de chaume + cheminée ──
  default: {
    body();
    roofTri(enemy?roofLt:'#b8763a', enemy?roofCol:'#8a5424', 0.4);
    fill(pw*0.66,oy+ph*0.1,Math.max(3,T*0.14),T*0.3,wallDk);
    cx.fillStyle='rgba(210,210,210,.28)'; // fumée de cheminée : signe de vie, la maison n'est pas une coquille vide
    for(let k=0;k<3;k++){ cx.beginPath(); cx.arc(pw*0.66+T*0.07+k*T*0.045,oy+ph*0.1-T*0.08-k*T*0.11,T*0.06+k*T*0.02,0,Math.PI*2); cx.fill(); }
    door(0.18); windows();
    fill(pw*0.06,H-bodyH*0.1,T*0.2,T*0.09,'#6a4a26');  // jardinière sous la fenêtre : détail domestique
    fill(pw*0.06,H-bodyH*0.1,T*0.2,Math.max(1,T*0.02),'#8a6a3a');
    for(const fx3 of [pw*0.08,pw*0.14,pw*0.2]) fill(fx3,H-bodyH*0.16,Math.max(1,T*0.025),Math.max(1,T*0.025),'#e05070');
    break; }
  }
}

// utilitaires couleur
function lighten(hex,amt){ return shade(hex,amt); }
function darken(hex,amt){ return shade(hex,-amt); }
function shade(hex,amt){
  const h=hex.replace('#',''); 
  let r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  const f=v=>Math.max(0,Math.min(255,Math.round(v+ (amt/100)*255)));
  r=f(r);g=f(g);b=f(b);
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

// ── UNITÉS (8 frames de marche optionnelles, ici 1 pose nette) ──
function buildUnits(T){
  SPR.unit={};
  for(const type of Object.keys(UDEF)){
    SPR.unit[type]=buildUnitSprite(type,T,0);
    // Cycle de marche : 2 frames supplémentaires (foulée gauche/droite) pour
    // les unités bipèdes au sol. Cavalerie et trébuchet gardent une pose
    // unique (leur mouvement se lit déjà via la monture / les roues + le
    // bobbing) — leur dessiner un vrai cycle de jambes n'aurait pas de sens.
    const isCav=CAV_TYPES.includes(type);
    if(!UDEF[type].siege&&!isCav){
      SPR.unit[type+'_W1']=buildUnitSprite(type,T,1);
      SPR.unit[type+'_W2']=buildUnitSprite(type,T,-1);
    }
  }
}

// ── SURCOUCHE : unités illustrées, en amélioration progressive ────────
// même principe que les bâtiments (voir upgradeBuildingSprites) : chargement
// asynchrone depuis assets/unites/, échec silencieux, sprite procédural
// conservé tant que le fichier n'existe pas. Pas de variante « camp
// ennemi » nécessaire ici : contrairement aux bâtiments, le rendu des
// unités ne teinte déjà pas le camp adverse en rouge (voir le liseré au
// sol dans drawUnits) — l'illustration remplace donc la pose de base ET
// les deux frames de foulée (_W1/_W2) par la même image : seul le
// bobbing vertical anime encore la marche, mais aucune bascule visuelle
// disparate entre une pose dessinée et une pose illustrée à chaque pas.
const UNIT_SPRITE_FILES={ [UT.VIL]:'villageois', [UT.MIL]:'milicien', [UT.ARC]:'archer', [UT.KNIGHT]:'chevalier',
  [UT.MONK]:'moine', [UT.PALADIN]:'paladin', [UT.PIKE]:'piquier', [UT.XBOW]:'arbaletrier',
  [UT.SCOUT]:'eclaireur', [UT.HERO]:'heros', [UT.BOAT]:'barque', [UT.TREB]:'trebuchet', [UT.RAM]:'belier',
  [UT.ENEMI]:'pillard', [UT.ENEMIA]:'archer_pillard', [UT.ENEMI_G]:'geant', [UT.ENEMI_C]:'cavalier_noir', [UT.ENEMI_BOSS]:'seigneur_guerre' };

// Détoure (même flood fill que les bâtiments) et centre horizontalement,
// ancré un peu au-dessus du bas du canvas carré S×S — c'est là que
// buildUnitSprite plaçait déjà l'ombre et les pieds (voir cx.ellipse à
// S*0.84 plus haut), donc la nouvelle silhouette pose au même endroit.
function fitUnitImage(src,S){
  const t=stripBgTrimmed(src,TRIM_W_UNIT); if(!t) return null;
  const{c:wc,minX,minY,bw,bh}=t;
  const{c,cx}=offCanvas(S,S);
  const scale=Math.min(S*0.8/bw,S*0.78/bh);
  const dw=bw*scale,dh=bh*scale;
  cx.drawImage(wc,minX,minY,bw,bh,(S-dw)/2,S*0.88-dh,dw,dh);
  return{c,cx};
}

function upgradeUnitSprites(){
  for(const type in UNIT_SPRITE_FILES){
    withIllustration('assets/unites/'+UNIT_SPRITE_FILES[type]+ASSET_EXT,TRIM_W_UNIT,(url)=>{
      // Les trois poses partagent la même taille de canvas : un seul cadrage
      // suffit, réutilisé tel quel pour les deux frames de marche.
      let fitted=null, fittedS=-1;
      for(const suf of ['','_W1','_W2']){
        const meta=SPR.unit[type+suf]; if(!meta) continue;
        if(meta.c.width!==fittedS){ fitted=fitUnitImage(url,meta.c.width); fittedS=meta.c.width; }
        if(!fitted) return;
        SPR.unit[type+suf]=Object.assign({},meta,fitted);
      }
    });
  }
}

// ── SURCOUCHE : gisements/ressources de la carte illustrés ────────────
// même principe que bâtiments/unités (voir upgradeBuildingSprites) :
// chargement asynchrone depuis assets/ressources/, échec silencieux,
// sprite procédural conservé tant que le fichier n'existe pas. Chaque type
// de nœud (arbre, pierre, or, baies, poisson, viande) a plusieurs variantes
// procédurales dans SPR[type] (cassent la répétition visuelle sur la
// carte) ; l'illustration remplace TOUTES les variantes d'un type par la
// même image, comme pour les frames de marche des unités — un seul fichier
// par type suffit, pas la peine de générer 3-5 variantes par ressource.
const NODE_SPRITE_FILES={ tree:'arbre', stone:'gisement_pierre', gold:'gisement_or', berry:'buisson_baies', fish:'banc_poissons', meat:'viande' };

// Ancrage au sol différent de fitUnitImage : l'Arbre est bien plus haut que
// large (tronc + canopée, socle vers 95% du canvas) tandis que les gisements
// de pierre/or/baies/poisson/viande sont posés bas avec une ombre large vers
// 78-80% (voir buildStoneNode/buildGoldNode/etc.) — ancrer l'Arbre à 0.8
// comme les autres le ferait flotter au-dessus du sol.
const NODE_GROUND_FRAC={ tree:0.95, stone:0.8, gold:0.8, berry:0.78, fish:0.78, meat:0.78 };

function fitNodeImage(src,S,groundFrac){
  const t=stripBgTrimmed(src,TRIM_W_NODE); if(!t) return null;
  const{c:wc,minX,minY,bw,bh}=t;
  const{c,cx}=offCanvas(S,S);
  const scale=Math.min(S*0.9/bw,S*0.9/bh);
  const dw=bw*scale,dh=bh*scale;
  cx.drawImage(wc,minX,minY,bw,bh,(S-dw)/2,S*groundFrac-dh,dw,dh);
  return{c,cx};
}

// Comme pour les bâtiments : buildSprites() (donc buildTrees/buildStoneNode/
// etc.) est régénéré à chaque changement de zoom, la surcouche illustrée doit
// donc être réappliquée ensuite — mais sans jamais refaire le détourage, qui
// est mutualisé par withIllustration/TRIM_CACHE.
function upgradeResourceNodes(){
  for(const type in NODE_SPRITE_FILES){
    const gf=NODE_GROUND_FRAC[type];
    withIllustration('assets/ressources/'+NODE_SPRITE_FILES[type]+ASSET_EXT,TRIM_W_NODE,(url)=>{
      const arr=SPR[type]; if(!arr||!arr.length) return;
      // Toutes les variantes procédurales d'un type ont la même taille : on ne
      // recadre qu'une fois et on partage le canvas obtenu.
      let fitted=null, fittedS=-1;
      for(let i=0;i<arr.length;i++){
        const meta=arr[i]; if(!meta) continue;
        if(meta.c.width!==fittedS){ fitted=fitNodeImage(url,meta.c.width,gf); fittedS=meta.c.width; }
        if(!fitted) return;
        arr[i]=Object.assign({},meta,fitted);
      }
    });
  }
}

// ── SURCOUCHE : faune sauvage illustrée (Cerf, Sanglier) ──────────────
// même principe que les gisements (voir upgradeResourceNodes) : un seul
// fichier par type (pas de variantes à casser ici, une seule pose chacun),
// détouré et ancré au sol via fitNodeImage (silhouette basse à pattes
// visibles, même ancrage ~0.82 que les gisements courts).
const WILDLIFE_SPRITE_FILES={ deer:'cerf', boar:'sanglier' };
const WILDLIFE_GROUND_FRAC=0.82;
function upgradeWildlifeSprites(){
  for(const type in WILDLIFE_SPRITE_FILES){
    withIllustration('assets/unites/'+WILDLIFE_SPRITE_FILES[type]+ASSET_EXT,TRIM_W_NODE,(url)=>{
      const meta=SPR.wildlife[type]; if(!meta) return;
      const fitted=fitNodeImage(url,meta.c.width,WILDLIFE_GROUND_FRAC); if(!fitted) return;
      SPR.wildlife[type]=Object.assign({},meta,fitted);
    });
  }
}

// ── SURCOUCHE : objets uniques illustrés (Relique, Caravane) ──────────
// Ni bâtiment/unité/gisement à proprement parler : SPR.relic et SPR.caravan
// sont chacun un objet {c,cx,S} unique (pas de variantes, pas de tableau
// par type) construit une seule fois par buildSprites(). Même détourage/
// ancrage via fitNodeImage que les gisements.
const SINGLETON_SPRITE_FILES={
  relic:  { file:'ressources/relique', frac:0.86 },
  caravan:{ file:'unites/caravane',    frac:0.86 },
};
function upgradeSingletonSprites(){
  for(const key in SINGLETON_SPRITE_FILES){
    const{file,frac}=SINGLETON_SPRITE_FILES[key];
    withIllustration('assets/'+file+ASSET_EXT,TRIM_W_NODE,(url)=>{
      const meta=SPR[key]; if(!meta) return;
      const fitted=fitNodeImage(url,meta.c.width,frac); if(!fitted) return;
      SPR[key]=Object.assign({},meta,fitted);
    });
  }
}

// Monture pour la cavalerie (Chevalier / Paladin / Cavalier Noir) — dessinée
// AVANT le cavalier (arrière-plan) : sans elle, ces unités n'étaient qu'un
// rectangle brun accolé au torse, illisible comme "monté".
function drawHorse(cx,cxp,S,enemy){
  // Réécrit : la version précédente empilait un corps rectangulaire plat, une
  // encolure filiforme et quatre pattes droites régulièrement espacées — vu
  // de loin, et surtout une fois le cavalier assis dessus, ça se lisait comme
  // un banc à quatre pieds. Trois changements portent toute la lisibilité :
  //   • une silhouette COURBE (poitrail bombé, croupe ronde, ligne de ventre
  //     remontante) au lieu d'un rectangle ;
  //   • une encolure épaisse qui descend vers l'avant et une tête nettement
  //     plus grande, avec chanfrein clair et naseau — c'est la tête qui fait
  //     dire « cheval » en un coup d'œil ;
  //   • des pattes COUDÉES et décalées deux à deux (une paire proche foncée,
  //     une paire lointaine plus sombre encore), ce qui interdit la lecture
  //     « pieds de meuble ».
  // La robe ennemie passe de #2a1e18 (quasi noir) à un bai brûlé : sur du
  // presque-noir, crinière, sabots et reflets disparaissaient purement et
  // simplement, ce qui expliquait une bonne part de l'effet « planche ».
  const hCol=enemy?'#4a3423':'#7a4f2c';
  const hDk=shade(hCol,-26), hDk2=shade(hCol,-42), hLt=shade(hCol,20);
  const mane=shade(hCol,-58), hoof='#221a12', belly=shade(hCol,26);
  const yBack=S*0.50, yBelly=S*0.71, yHoof=S*0.90;
  const xAv=cxp+S*0.20, xAr=cxp-S*0.34;   // poitrail / croupe

  // ── pattes ── deux plans : la paire éloignée d'abord, plus sombre, ce qui
  // creuse la profondeur sous le ventre au lieu d'aligner quatre bâtons.
  const patte=(x,col,dec)=>{
    const w=Math.max(1.6,S*0.055);
    px(cx,x,yBelly-S*0.03,w,S*0.11,col);              // haut (épaule/cuisse)
    px(cx,x+dec,yBelly+S*0.07,w*0.82,S*0.09,col);     // canon, légèrement coudé
    px(cx,x+dec,yHoof-S*0.035,w*0.9,S*0.035,hoof);    // sabot
  };
  patte(cxp+S*0.02,hDk2,S*0.012);   // antérieur éloigné
  patte(cxp-S*0.20,hDk2,-S*0.012);  // postérieur éloigné
  patte(cxp+S*0.12,hDk,S*0.018);    // antérieur proche
  patte(cxp-S*0.29,hDk,-S*0.018);   // postérieur proche

  // ── queue ── un trait effilé, pas une nappe : remplie comme une surface,
  // elle couvrait toute la croupe d'un aplat presque noir qui se lisait comme
  // une aile repliée.
  cx.strokeStyle=hDk2; cx.lineCap='round';
  cx.lineWidth=Math.max(2,S*0.075);
  cx.beginPath();
  cx.moveTo(xAr+S*0.04,yBack+S*0.02);
  cx.quadraticCurveTo(xAr-S*0.05,yBack+S*0.12,xAr-S*0.03,yBelly+S*0.08);
  cx.stroke();
  cx.strokeStyle=mane; cx.lineWidth=Math.max(1,S*0.035);
  cx.beginPath();
  cx.moveTo(xAr+S*0.04,yBack+S*0.04);
  cx.quadraticCurveTo(xAr-S*0.04,yBack+S*0.13,xAr-S*0.025,yBelly+S*0.06);
  cx.stroke();

  // ── tronc ── un seul tracé fermé : croupe ronde, dos droit, poitrail bombé,
  // ligne de ventre qui remonte vers l'arrière (le « creux du flanc »).
  cx.fillStyle=hCol;
  cx.beginPath();
  cx.moveTo(xAr+S*0.03,yBack+S*0.03);
  cx.quadraticCurveTo(xAr-S*0.02,yBack-S*0.02,xAr+S*0.10,yBack-S*0.03);  // croupe
  cx.lineTo(xAv-S*0.06,yBack-S*0.02);                                     // dos
  cx.quadraticCurveTo(xAv+S*0.06,yBack+S*0.01,xAv+S*0.05,yBack+S*0.12);   // poitrail
  cx.quadraticCurveTo(xAv+S*0.02,yBelly+S*0.02,xAv-S*0.10,yBelly);        // sous-poitrail
  cx.quadraticCurveTo(xAr+S*0.14,yBelly-S*0.03,xAr+S*0.04,yBelly-S*0.06); // ventre remontant
  cx.closePath(); cx.fill();
  px(cx,xAr+S*0.06,yBack-S*0.02,S*0.46,Math.max(2,S*0.045),hLt);          // reflet de dos
  px(cx,xAr+S*0.08,yBelly-S*0.09,S*0.36,Math.max(2,S*0.04),belly);        // ventre clair
  px(cx,xAv-S*0.16,yBack+S*0.06,Math.max(1,S*0.02),S*0.11,hDk);           // pli de l'épaule

  // ── encolure ── large en bas, qui s'incline vers l'avant en montant
  cx.fillStyle=hCol;
  cx.beginPath();
  cx.moveTo(xAv-S*0.09,yBack-S*0.01);
  cx.quadraticCurveTo(xAv+S*0.02,yBack-S*0.13,cxp+S*0.30,S*0.31);   // ligne de crinière
  cx.lineTo(cxp+S*0.39,S*0.35);                                      // gorge, en haut
  cx.quadraticCurveTo(cxp+S*0.28,S*0.47,xAv+S*0.07,yBack+S*0.14);    // bord avant, bombé
  cx.closePath(); cx.fill();
  // ombre de gorge : détache l'encolure du poitrail au lieu d'un bloc continu
  px(cx,cxp+S*0.24,S*0.42,Math.max(1,S*0.025),S*0.10,hDk);

  // ── crinière ── le long du bord SUPÉRIEUR de l'encolure, du garrot aux oreilles
  cx.strokeStyle=mane; cx.lineWidth=Math.max(2,S*0.048); cx.lineCap='round';
  cx.beginPath();
  cx.moveTo(xAv-S*0.10,yBack-S*0.01);
  cx.quadraticCurveTo(xAv+S*0.01,yBack-S*0.13,cxp+S*0.30,S*0.30);
  cx.stroke();

  // ── tête ── museau tendu vers l'avant-bas ; c'est la pièce qui identifie
  // l'animal, donc large, contrastée et détachée de l'encolure par une ombre.
  cx.fillStyle=hCol;
  cx.beginPath();
  cx.moveTo(cxp+S*0.25,S*0.25);
  cx.lineTo(cxp+S*0.37,S*0.245);
  cx.quadraticCurveTo(cxp+S*0.47,S*0.30,cxp+S*0.455,S*0.385);  // chanfrein
  cx.lineTo(cxp+S*0.36,S*0.425);
  cx.quadraticCurveTo(cxp+S*0.27,S*0.41,cxp+S*0.25,S*0.34);    // ganache
  cx.closePath(); cx.fill();
  px(cx,cxp+S*0.30,S*0.25,S*0.14,Math.max(1,S*0.035),hLt);                      // arête du chanfrein éclairée
  px(cx,cxp+S*0.40,S*0.345,S*0.055,S*0.045,belly);                              // bout du nez clair
  px(cx,cxp+S*0.405,S*0.365,Math.max(1,S*0.025),Math.max(1,S*0.025),hDk);       // naseau
  px(cx,cxp+S*0.32,S*0.30,Math.max(1,S*0.04),Math.max(1,S*0.04),'#15100c');     // œil
  // oreilles dressées, écartées : deuxième repère de « tête » après le museau
  px(cx,cxp+S*0.255,S*0.195,Math.max(1,S*0.032),S*0.06,mane);
  px(cx,cxp+S*0.315,S*0.19,Math.max(1,S*0.032),S*0.065,mane);

  // ── harnachement ── selle sous le cavalier + tapis, filet et rêne : trois
  // traits qui disent « monture sellée » et non « animal sauvage ».
  const selle=enemy?'#3a1c1c':'#4a2c14';
  px(cx,cxp-S*0.10,yBack-S*0.05,S*0.24,S*0.06,selle);
  px(cx,cxp-S*0.10,yBack-S*0.05,S*0.24,Math.max(1,S*0.02),'rgba(255,255,255,.22)');
  px(cx,cxp-S*0.13,yBack+S*0.01,S*0.30,Math.max(2,S*0.04),enemy?'#6a2424':'#8a3a2a'); // tapis de selle
  cx.strokeStyle=selle; cx.lineWidth=Math.max(1,S*0.022);
  cx.beginPath(); cx.moveTo(cxp+S*0.33,S*0.36); cx.lineTo(cxp+S*0.09,yBack+S*0.02); cx.stroke(); // rêne
  px(cx,cxp+S*0.335,S*0.325,S*0.06,Math.max(1,S*0.022),selle);                                  // filet
}

// Trébuchet : engin de siège à part entière (roues, bâti en A, bras, contre-
// poids). Il partageait auparavant le corps humanoïde de base + des pièces
// de machine par-dessus — on avait un soldat avec un bout de bois greffé.
function drawTrebuchetSprite(cx,cxp,S,enemy){
  const wood='#6a4a28', woodDk='#4a3018', metal=enemy?'#7a3838':'#8a8a92';
  const baseY=S*0.72;
  cx.fillStyle=woodDk;
  cx.beginPath(); cx.arc(cxp-S*0.22,baseY,S*0.09,0,Math.PI*2); cx.fill();
  cx.beginPath(); cx.arc(cxp+S*0.22,baseY,S*0.09,0,Math.PI*2); cx.fill();
  cx.fillStyle='#2c1e12';
  cx.beginPath(); cx.arc(cxp-S*0.22,baseY,S*0.03,0,Math.PI*2); cx.fill();
  cx.beginPath(); cx.arc(cxp+S*0.22,baseY,S*0.03,0,Math.PI*2); cx.fill();
  px(cx,cxp-S*0.3,baseY-S*0.06,S*0.6,S*0.08,wood);             // châssis
  cx.strokeStyle=woodDk; cx.lineWidth=Math.max(3,S*0.045);
  cx.beginPath(); cx.moveTo(cxp-S*0.2,baseY); cx.lineTo(cxp,S*0.14); cx.stroke();
  cx.beginPath(); cx.moveTo(cxp+S*0.2,baseY); cx.lineTo(cxp,S*0.14); cx.stroke();
  cx.beginPath(); cx.moveTo(cxp-S*0.14,baseY-S*0.28); cx.lineTo(cxp+S*0.14,baseY-S*0.28); cx.stroke();
  cx.strokeStyle=wood; cx.lineWidth=Math.max(3,S*0.05);
  cx.beginPath(); cx.moveTo(cxp-S*0.1,S*0.2); cx.lineTo(cxp+S*0.32,S*0.5); cx.stroke(); // bras
  px(cx,cxp-S*0.23,S*0.15,S*0.16,S*0.16,metal);                // contrepoids
  px(cx,cxp-S*0.2,S*0.17,S*0.06,S*0.06,enemy?'#a05050':'#b0b0b8');
  cx.strokeStyle='#3a281a'; cx.lineWidth=Math.max(1.5,S*0.02);
  cx.beginPath(); cx.moveTo(cxp+S*0.32,S*0.5); cx.lineTo(cxp+S*0.38,S*0.62); cx.stroke(); // fronde
  cx.fillStyle='#777';
  cx.beginPath(); cx.arc(cxp+S*0.38,S*0.63,S*0.045,0,Math.PI*2); cx.fill(); // boulet
}

// Bélier : abri à toit pentu sur roues, protégeant la poutre suspendue à
// tête de fer — même traitement "machine, pas soldat" que le trébuchet.
function drawRamSprite(cx,cxp,S,enemy){
  const wood='#6a4a28', woodDk='#4a3018', roof=enemy?'#7a3838':'#8a5a2a', roofDk=enemy?'#521f1f':'#5a3818', metal=enemy?'#9a4444':'#9a9aa2';
  const baseY=S*0.74, frameY=S*0.3, frameH=baseY-frameY;
  // roues
  for(const wx of [-0.3,0.3]){
    cx.fillStyle=woodDk; cx.beginPath(); cx.arc(cxp+wx*S,baseY,S*0.1,0,Math.PI*2); cx.fill();
    cx.fillStyle='#2c1e12'; cx.beginPath(); cx.arc(cxp+wx*S,baseY,S*0.035,0,Math.PI*2); cx.fill();
    cx.strokeStyle='#8a6a3a'; cx.lineWidth=Math.max(1,S*0.02);
    cx.beginPath(); cx.moveTo(cxp+wx*S-S*0.08,baseY); cx.lineTo(cxp+wx*S+S*0.08,baseY); cx.stroke();
    cx.beginPath(); cx.moveTo(cxp+wx*S,baseY-S*0.08); cx.lineTo(cxp+wx*S,baseY+S*0.08); cx.stroke();
  }
  // montants du châssis
  cx.strokeStyle=wood; cx.lineWidth=Math.max(3,S*0.05);
  cx.beginPath(); cx.moveTo(cxp-S*0.3,baseY); cx.lineTo(cxp-S*0.3,frameY); cx.stroke();
  cx.beginPath(); cx.moveTo(cxp+S*0.3,baseY); cx.lineTo(cxp+S*0.3,frameY); cx.stroke();
  // toit pentu de protection
  cx.fillStyle=roof;
  cx.beginPath(); cx.moveTo(cxp,S*0.06); cx.lineTo(cxp+S*0.4,frameY); cx.lineTo(cxp-S*0.4,frameY); cx.closePath(); cx.fill();
  cx.fillStyle=roofDk;
  cx.beginPath(); cx.moveTo(cxp,S*0.06); cx.lineTo(cxp+S*0.4,frameY); cx.lineTo(cxp+S*0.28,frameY); cx.closePath(); cx.fill();
  // poutre suspendue, tête de fer pointée vers l'avant (droite)
  const ry=(frameY+baseY)/2;
  cx.strokeStyle='#3a2818'; cx.lineWidth=Math.max(1,S*0.018);
  cx.beginPath(); cx.moveTo(cxp-S*0.24,frameY+S*0.02); cx.lineTo(cxp+S*0.02,ry); cx.stroke(); // chaîne avant
  cx.beginPath(); cx.moveTo(cxp+S*0.24,frameY+S*0.02); cx.lineTo(cxp+S*0.36,ry); cx.stroke(); // chaîne arrière
  px(cx,cxp-S*0.02,ry-S*0.05,S*0.4,S*0.1,wood);                 // poutre
  px(cx,cxp-S*0.02,ry-S*0.05,S*0.4,Math.max(1,S*0.02),'rgba(255,255,255,.18)');
  cx.fillStyle=metal;
  cx.beginPath(); cx.moveTo(cxp+S*0.38,ry); cx.lineTo(cxp+S*0.5,ry-S*0.07); cx.lineTo(cxp+S*0.5,ry+S*0.07); cx.closePath(); cx.fill(); // tête de bélier
}

// ── BARQUE DE PÊCHE : jusqu'ici sans case dédiée, elle retombait sur le
// corps humanoïde générique — une Barque ressemblait à un villageois en
// tunique bleue debout sur l'herbe. Coque en amande vue de dessus, banc,
// rames croisées, prise du jour ; sillage clair en guise d'ombre au sol. ──
function drawBoatSprite(cx,cxp,S,enemy){
  // Réécrit en vue de PROFIL. La version précédente montrait la barque de
  // dessus : une amande brune posée à plat, creusée d'une grande ellipse
  // sombre, avec deux avirons tracés en foncé sur foncé. Résultat, à la
  // taille de jeu, une assiette marron — et un point de vue qui jurait avec
  // toutes les autres unités, dessinées de face/de profil. Ici : coque avec
  // étrave relevée, ligne de flottaison, mât et voile. La voile est la pièce
  // décisive : c'est la seule forme claire et haute de la silhouette, celle
  // qui fait reconnaître un bateau avant tout le reste.
  const hull=enemy?'#7a4436':'#8a6a44', hullDk=shade(hull,-30), hullLt=shade(hull,22);
  const deck=shade(hull,14);
  const sail=enemy?'#d8a898':'#ece2c6', sailDk=shade(sail,-16);
  const wl=S*0.66;                       // ligne de flottaison
  const xAr=cxp-S*0.40, xAv=cxp+S*0.42;  // poupe (gauche) / proue (droite)

  // ── sillage ── deux arcs d'écume, plus larges à l'arrière : pose le bateau
  // sur l'eau (aucune ombre au sol n'est dessinée pour cette unité).
  cx.strokeStyle='rgba(232,244,255,.5)'; cx.lineWidth=Math.max(1,S*0.022); cx.lineCap='round';
  for(const [dy,ext] of [[0.06,0.10],[0.11,0.18]]){
    cx.beginPath();
    cx.moveTo(xAr-S*ext,wl+S*dy);
    cx.quadraticCurveTo(cxp,wl+S*(dy+0.05),xAv+S*0.04,wl+S*dy);
    cx.stroke();
  }

  // ── coque ── croissant : quille creuse, étrave nettement relevée à droite,
  // étambot plus court à gauche.
  cx.fillStyle=hull;
  cx.beginPath();
  cx.moveTo(xAr,S*0.50);
  cx.lineTo(xAv,S*0.455);                                        // ligne de plat-bord
  cx.quadraticCurveTo(xAv-S*0.02,S*0.60,xAv-S*0.10,S*0.70);      // étrave
  cx.quadraticCurveTo(cxp,S*0.78,xAr+S*0.09,S*0.685);            // quille
  cx.quadraticCurveTo(xAr-S*0.01,S*0.62,xAr,S*0.50);             // étambot
  cx.closePath(); cx.fill();
  px(cx,xAr+S*0.02,S*0.475,S*0.78,Math.max(2,S*0.04),deck);      // plat-bord éclairé
  px(cx,xAr+S*0.05,S*0.555,S*0.72,Math.max(1,S*0.025),hullDk);   // virure de bordé
  // partie immergée, plus sombre et plus froide
  cx.save(); cx.beginPath();
  cx.rect(xAr-S*0.05,wl,S*0.95,S*0.16); cx.clip();
  cx.fillStyle='rgba(16,52,86,.42)';
  cx.fillRect(xAr-S*0.05,wl,S*0.95,S*0.16);
  cx.restore();

  // ── mât et vergue ──
  const mx=cxp-S*0.06, myTop=S*0.10;
  px(cx,mx,myTop,Math.max(2,S*0.035),S*0.42,'#6a4a28');
  px(cx,mx-S*0.09,myTop+S*0.03,S*0.24,Math.max(2,S*0.028),'#5a3e20'); // vergue
  // ── voile ── carrée, ventrue vers l'avant : la forme qui dit « bateau »
  cx.fillStyle=sail;
  cx.beginPath();
  cx.moveTo(mx-S*0.08,myTop+S*0.05);
  cx.lineTo(mx+S*0.15,myTop+S*0.05);
  cx.quadraticCurveTo(mx+S*0.25,S*0.28,mx+S*0.16,S*0.40);
  cx.lineTo(mx-S*0.07,S*0.40);
  cx.quadraticCurveTo(mx-S*0.02,S*0.28,mx-S*0.08,myTop+S*0.05);
  cx.closePath(); cx.fill();
  px(cx,mx-S*0.06,S*0.245,S*0.21,Math.max(2,S*0.03),enemy?'#a85a4a':'#c0392b'); // bande de couleur
  cx.fillStyle=sailDk;                                            // pli d'ombre au guindant
  cx.beginPath();
  cx.moveTo(mx-S*0.08,myTop+S*0.05); cx.lineTo(mx-S*0.03,myTop+S*0.05);
  cx.quadraticCurveTo(mx+S*0.02,S*0.28,mx-S*0.02,S*0.40); cx.lineTo(mx-S*0.07,S*0.40);
  cx.quadraticCurveTo(mx-S*0.02,S*0.28,mx-S*0.08,myTop+S*0.05);
  cx.closePath(); cx.fill();
  cx.strokeStyle='rgba(60,40,20,.55)'; cx.lineWidth=Math.max(1,S*0.018); // étai vers l'étrave
  cx.beginPath(); cx.moveTo(mx+S*0.01,myTop); cx.lineTo(xAv-S*0.03,S*0.46); cx.stroke();

  // ── aviron de gouverne à la poupe, bien détaché sur le fond ──
  cx.strokeStyle=hullLt; cx.lineWidth=Math.max(1,S*0.03);
  cx.beginPath(); cx.moveTo(xAr+S*0.06,S*0.50); cx.lineTo(xAr-S*0.10,S*0.70); cx.stroke();
  px(cx,xAr-S*0.13,S*0.68,S*0.07,S*0.05,hullLt);

  // ── cageot de pêche sur le pont : rappelle à quoi sert la barque ──
  px(cx,cxp+S*0.14,S*0.40,S*0.14,S*0.08,'#a5844f');
  px(cx,cxp+S*0.14,S*0.40,S*0.14,Math.max(1,S*0.02),'#c9a869');
  px(cx,cxp+S*0.17,S*0.375,S*0.08,S*0.03,'#b8c8d8');  // poisson qui dépasse
}

function buildUnitSprite(type,T,legPhase){
  legPhase=legPhase||0; // -1 / 0 / 1 : phase de foulée (cycle de marche)
  const enemy=[UT.ENEMI,UT.ENEMIA,UT.ENEMI_G,UT.ENEMI_C,UT.ENEMI_BOSS].includes(type);
  const isTreb=type===UT.TREB;
  const isRam=type===UT.RAM;
  const isBoat=type===UT.BOAT;
  const isCav=CAV_TYPES.includes(type);
  // Géant et Seigneur de Guerre : silhouette agrandie — la menace doit se
  // lire avant même le premier coup d'épée (convention AoE2 : plus gros
  // = plus dangereux). Comme tous les traits sont des fractions de S, ce
  // seul facteur redimensionne l'ensemble du dessin proportionnellement.
  const sizeMult = type===UT.ENEMI_BOSS?1.5 : type===UT.ENEMI_G?1.26 : 1;
  // 0,95 et non 0,85 : les unités illustrées se lisaient un peu petites face
  // aux bâtiments. Ce seul facteur commande toute leur taille à l'écran —
  // drawUnits, les anneaux de sélection et l'ellipse de survol lisent tous
  // spr.S, qui en découle.
  const S=Math.round(T*0.95*sizeMult);
  const{c,cx}=offCanvas(S,S);
  // Meme raccourci que pour les batiments : l'illustration remplace la pose
  // de base ET les deux frames de foulee, inutile de peindre dessous.
  if(UNIT_SPRITE_FILES[type]&&illustrationPrete('assets/unites/'+UNIT_SPRITE_FILES[type]+ASSET_EXT))
    return {c,cx,S:S/SS};
  const cxp=S/2;
  const body=UCOL[type]||'#888';
  const skin='#e0b088';
  const ln=Math.max(3,Math.round(S*0.045));

  // ombre au sol — large et basse pour l'engin de siège posé, ellipse
  // resserrée sous les pieds pour une unité debout
  cx.fillStyle='rgba(0,0,0,.25)';
  cx.beginPath();
  if(isTreb||isRam) cx.ellipse(cxp,S*0.82,S*0.34,S*0.06,0,0,Math.PI*2);
  else if(!isBoat) cx.ellipse(cxp,S*0.84,S*0.22,S*0.045,0,0,Math.PI*2); // la Barque dessine son propre sillage
  cx.fill();

  if(isTreb){ drawTrebuchetSprite(cx,cxp,S,enemy); return {c,cx,S:S/SS}; }
  if(isRam){ drawRamSprite(cx,cxp,S,enemy); return {c,cx,S:S/SS}; }
  if(isBoat){ drawBoatSprite(cx,cxp,S,enemy); return {c,cx,S:S/SS}; }

  if(isCav) drawHorse(cx,cxp,S,enemy);

  // jambes séparées (gap central) + bottes plus sombres : lisible comme une
  // silhouette en marche plutôt qu'un bloc unique. Le cavalier n'en affiche
  // pas : assis, ses jambes sont cachées par le corps de sa monture.
  if(!isCav){
    const legY=S*0.6, legH=S*0.22;
    // décalage de foulée : une jambe avance (remonte) pendant que l'autre
    // recule (descend) — combiné au bobbing déjà en place à l'affichage,
    // ça donne un vrai cycle de marche à 2 frames plutôt qu'une pose figée.
    const off=legPhase*S*0.05;
    px(cx,cxp-S*0.13,legY-off,S*0.09,legH,'#3a2c1c');
    px(cx,cxp+S*0.04,legY+off,S*0.09,legH,'#3a2c1c');
    px(cx,cxp-S*0.13,legY-off+legH-S*0.05,S*0.09,S*0.05,'#241a10');
    px(cx,cxp+S*0.04,legY+off+legH-S*0.05,S*0.09,S*0.05,'#241a10');
  }

  // torse (le cavalier est assis plus haut, sur le dos du cheval)
  const torsoY=isCav?S*0.3:S*0.34;
  px(cx,cxp-S*0.16,torsoY,S*0.32,S*0.3,body);
  px(cx,cxp-S*0.16,torsoY,S*0.32,Math.max(2,S*0.04),'rgba(255,255,255,.22)');
  px(cx,cxp+S*0.1,torsoY,S*0.06,S*0.3,'rgba(0,0,0,.15)');
  px(cx,cxp+S*0.12,torsoY+S*0.03,S*0.08,S*0.12,shade(body,-12)); // bras/épaule : casse le bloc plat
  px(cx,cxp-S*0.16,torsoY+S*0.24,S*0.32,Math.max(2,S*0.035),shade(body,-30)); // ceinture : sépare torse/jambes, ancre le costume
  if(type===UT.VIL){ // tablier de paysan : casse le bloc de couleur unie, lit "civil" au premier coup d'œil
    px(cx,cxp-S*0.13,torsoY+S*0.1,S*0.26,S*0.2,'#c9a869');
    px(cx,cxp-S*0.13,torsoY+S*0.1,S*0.26,Math.max(1,S*0.025),'#e8d5a0');
    px(cx,cxp-S*0.2,S*0.42,S*0.09,S*0.1,'#5a3c1c');    // besace à la ceinture
  } else if(type===UT.MIL||type===UT.ENEMI||type===UT.PIKE||type===UT.ENEMI_C){ // cotte de mailles : grille de rivets, lit "armure" à distance
    for(let ry=torsoY+S*0.05;ry<torsoY+S*0.24;ry+=S*0.055)
      for(let rx=cxp-S*0.13;rx<cxp+S*0.11;rx+=S*0.055)
        px(cx,rx,ry,Math.max(1,S*0.018),Math.max(1,S*0.018),shade(body,-20));
  } else if(type===UT.ARC||type===UT.ENEMIA||type===UT.XBOW){ // baudrier de cuir croisé sur la veste
    cx.strokeStyle=shade(body,-28); cx.lineWidth=Math.max(1.5,S*0.025);
    cx.beginPath(); cx.moveTo(cxp-S*0.14,torsoY); cx.lineTo(cxp+S*0.1,torsoY+S*0.27); cx.stroke();
  } else if(type===UT.ENEMI_G||type===UT.ENEMI_BOSS){ // bandage sale + lanière de cuir croisée : brute mal en point, pas juste un bloc de couleur
    px(cx,cxp-S*0.14,torsoY+S*0.04,S*0.28,S*0.05,'#c9bfa0');
    px(cx,cxp-S*0.14,torsoY+S*0.06,S*0.28,Math.max(1,S*0.015),'#8a2020'); // tache de sang séché
    cx.strokeStyle='#2a2018'; cx.lineWidth=Math.max(2,S*0.03);
    cx.beginPath(); cx.moveTo(cxp-S*0.15,torsoY); cx.lineTo(cxp+S*0.12,torsoY+S*0.28); cx.stroke();
  }

  // tête
  const headY=isCav?S*0.12:S*0.16;
  px(cx,cxp-S*0.1,headY,S*0.2,S*0.2,skin);
  px(cx,cxp+S*0.02,headY+S*0.09,S*0.05,S*0.04,'rgba(0,0,0,.18)'); // ombre de visage : donne du volume
  if(type===UT.VIL){ px(cx,cxp-S*0.1,headY-S*0.02,S*0.2,S*0.06,'#7a4a20'); }
  else if(enemy){ px(cx,cxp-S*0.11,headY-S*0.02,S*0.22,S*0.08,'#222'); }
  else { px(cx,cxp-S*0.11,headY-S*0.03,S*0.22,S*0.08,'#9aa0a6'); }
  // regard : deux points sombres sous la coiffe/casque — lit "visage" sans surcharger la silhouette
  if(type!==UT.ENEMI_G&&type!==UT.ENEMI_BOSS){
    px(cx,cxp-S*0.05,headY+S*0.1,Math.max(1,S*0.02),Math.max(1,S*0.02),'#2a2018');
    px(cx,cxp+S*0.03,headY+S*0.1,Math.max(1,S*0.02),Math.max(1,S*0.02),'#2a2018');
  }

  // arme/outil selon type
  if(isCav){
    px(cx,cxp+S*0.22,S*0.04,ln,S*0.5,'#d8d8de');       // hampe de lance
    px(cx,cxp+S*0.19,S*0.04,S*0.1,S*0.06,'#e8e8ee');   // pointe
  } else if(type===UT.VIL){
    px(cx,cxp+S*0.16,S*0.2,ln,S*0.4,'#6a4a24');        // hache de bûcheron
    px(cx,cxp+S*0.16,S*0.2,S*0.12,S*0.08,'#bbbbc2');
  } else if(type===UT.MIL||type===UT.ENEMI){
    px(cx,cxp+S*0.18,S*0.18,ln,S*0.42,'#cfcfd6');      // épée
    px(cx,cxp+S*0.18,S*0.18,ln*1.6,Math.max(1,S*0.03),'#e8e8ee'); // pommeau/reflet de lame
    px(cx,cxp+S*0.14,S*0.32,S*0.12,ln,'#8a6a30');
    px(cx,cxp-S*0.19,S*0.42,S*0.07,S*0.16,'#4a3018');  // fourreau à la ceinture
  } else if(type===UT.ARC||type===UT.ENEMIA){
    px(cx,cxp+S*0.2,S*0.2,ln,S*0.36,'#8a5a2a');        // arc long
    cx.strokeStyle='#caa060'; cx.lineWidth=Math.max(2,ln*0.8);
    cx.beginPath(); cx.arc(cxp+S*0.22,S*0.38,S*0.18,-1,1); cx.stroke();
    px(cx,cxp-S*0.24,S*0.18,S*0.1,S*0.26,'#6a4a24');   // carquois dans le dos
    for(const fx4 of [-0.22,-0.19,-0.16]) px(cx,cxp+fx4*S,S*0.14,Math.max(1,S*0.02),S*0.1,'#caa060'); // empennage des flèches
  } else if(type===UT.XBOW){
    // arbalète : fût horizontal + arc court vertical — silhouette bien
    // distincte de l'archer, pas juste une recoloration
    px(cx,cxp+S*0.05,S*0.32,S*0.28,ln,'#5a3a1c');
    px(cx,cxp+S*0.27,S*0.22,ln,S*0.22,'#8a5a2a');
    cx.strokeStyle='#caa060'; cx.lineWidth=Math.max(1.5,ln*0.6);
    cx.beginPath(); cx.moveTo(cxp+S*0.27,S*0.21); cx.lineTo(cxp+S*0.27,S*0.45); cx.stroke();
    px(cx,cxp-S*0.2,S*0.4,S*0.1,S*0.1,'#4a3018');      // étui à carreaux à la ceinture
  } else if(type===UT.MONK){
    px(cx,cxp-S*0.16,S*0.3,S*0.32,S*0.34,'#d8cba0');   // robe claire
    px(cx,cxp-S*0.17,S*0.14,S*0.34,S*0.08,'#c0b18a');  // capuchon rabattu sur les épaules
    px(cx,cxp-S*0.16,S*0.5,S*0.32,Math.max(2,S*0.03),'#8a6a3a'); // corde de ceinture nouée
    // Étole colorée sur la robe : la teinte de camp est appliquée par rotation
    // de teinte (voir sprTeinte), or une bure quasi blanche n'a presque pas de
    // saturation à faire tourner — le Moine adverse ressortait identique au
    // nôtre. Cette bande, elle, prend la couleur du camp.
    px(cx,cxp-S*0.08,S*0.3,S*0.05,S*0.28,enemy?'#8b1a1a':'#2c5aa0');
    px(cx,cxp+S*0.05,S*0.3,S*0.05,S*0.28,enemy?'#8b1a1a':'#2c5aa0');
    px(cx,cxp-S*0.02,S*0.16,ln,S*0.12,'#caa83a');       // croix
    px(cx,cxp-S*0.06,S*0.2,S*0.12,ln,'#caa83a');
  } else if(type===UT.PIKE){
    px(cx,cxp+S*0.2,S*0.04,ln,S*0.6,'#cfcfd6');        // longue pique
    px(cx,cxp+S*0.19,S*0.04,ln+2,S*0.08,'#e8e8ee');
    px(cx,cxp-S*0.1,torsoY-S*0.03,S*0.2,Math.max(2,S*0.04),'#8a8a92'); // gorgerin métallique au col
  } else if(type===UT.ENEMI_G||type===UT.ENEMI_BOSS){
    px(cx,cxp+S*0.18,S*0.2,ln+1,S*0.4,'#4a3018');      // massue
    px(cx,cxp+S*0.14,S*0.16,S*0.14,S*0.14,'#6a4a28');
    px(cx,cxp-S*0.07,headY+S*0.17,Math.max(1,S*0.02),Math.max(2,S*0.035),'#f0ead8'); // croc inférieur
    px(cx,cxp+S*0.03,headY+S*0.17,Math.max(1,S*0.02),Math.max(2,S*0.035),'#f0ead8');
    if(type===UT.ENEMI_BOSS){                           // pointes d'épaule : reconnaissable de loin
      px(cx,cxp-S*0.24,S*0.32,S*0.05,S*0.12,'#1a1a1a');
      px(cx,cxp+S*0.19,S*0.32,S*0.05,S*0.12,'#1a1a1a');
    }
  }

  if(type===UT.HERO){
    // Le héros de civilisation ne traversait AUCUNE branche d'habillage : il
    // sortait en simple bonhomme jaune, alors que c'est l'unité unique de la
    // partie (une seule par camp, jamais reformée) et qu'il porte une aura de
    // commandement. Cape écarlate, panache et harnois doré : il doit se
    // repérer instantanément au milieu de sa propre armée.
    cx.fillStyle='#a01f2a';                                        // cape
    cx.beginPath();
    cx.moveTo(cxp-S*0.15,torsoY-S*0.02); cx.lineTo(cxp-S*0.36,torsoY+S*0.26);
    cx.lineTo(cxp-S*0.2,torsoY+S*0.34); cx.lineTo(cxp-S*0.1,torsoY+S*0.04);
    cx.closePath(); cx.fill();
    px(cx,cxp-S*0.17,torsoY-S*0.03,S*0.34,Math.max(2,S*0.05),'#f0d878');   // épaulières dorées
    px(cx,cxp-S*0.17,torsoY+S*0.13,S*0.34,Math.max(2,S*0.035),'#f0d878');  // ceinturon doré
    px(cx,cxp-S*0.05,torsoY+S*0.04,S*0.11,S*0.11,'#8b1a1a');               // écu de poitrine
    px(cx,cxp-S*0.03,torsoY+S*0.06,S*0.07,S*0.07,'#f0d878');
    px(cx,cxp-S*0.12,headY-S*0.05,S*0.24,Math.max(2,S*0.05),'#f0d878');    // bandeau du heaume
    px(cx,cxp-S*0.02,headY-S*0.19,Math.max(2,S*0.05),S*0.16,'#e03a3a');    // panache
    px(cx,cxp-S*0.05,headY-S*0.21,S*0.1,Math.max(2,S*0.05),'#f05050');
    px(cx,cxp+S*0.19,S*0.12,ln+1,S*0.46,'#f0e8c0');                        // épée à lame claire
    px(cx,cxp+S*0.16,S*0.12,S*0.12,Math.max(2,S*0.05),'#f0d878');          // garde dorée
    px(cx,cxp-S*0.28,torsoY+S*0.04,S*0.12,S*0.2,'#8b1a1a');                // bouclier
    px(cx,cxp-S*0.28,torsoY+S*0.04,S*0.12,Math.max(2,S*0.035),'#f0d878');
  }
  if(type===UT.KNIGHT||type===UT.PALADIN){ // cape flottant depuis l'épaule, sous le bouclier : la cavalerie noble se distingue du simple soldat
    const capeCol=enemy?'#5a1414':shade(body,-8);
    cx.fillStyle=capeCol;
    cx.beginPath();
    cx.moveTo(cxp-S*0.14,torsoY-S*0.02); cx.lineTo(cxp-S*0.34,torsoY+S*0.22); cx.lineTo(cxp-S*0.16,torsoY+S*0.3); cx.lineTo(cxp-S*0.1,torsoY+S*0.04);
    cx.closePath(); cx.fill();
    if(type===UT.PALADIN){ px(cx,cxp-S*0.03,headY-S*0.1,Math.max(2,S*0.05),S*0.14,enemy?'#c0392b':'#e8c84a'); } // panache au casque
  }
  if(type===UT.ENEMI_C){ // haillon sombre en cape + cornes au heaume : le "Cavalier Noir" doit se reconnaître avant même de charger
    cx.fillStyle='#1a1414';
    cx.beginPath();
    cx.moveTo(cxp-S*0.13,torsoY); cx.lineTo(cxp-S*0.3,torsoY+S*0.26); cx.lineTo(cxp-S*0.18,torsoY+S*0.16); cx.lineTo(cxp-S*0.24,torsoY+S*0.32); cx.lineTo(cxp-S*0.1,torsoY+S*0.06);
    cx.closePath(); cx.fill();
    px(cx,cxp-S*0.14,headY-S*0.05,Math.max(1,S*0.025),S*0.09,'#111'); // corne gauche
    px(cx,cxp+S*0.1,headY-S*0.05,Math.max(1,S*0.025),S*0.09,'#111'); // corne droite
  }
  if(type===UT.MIL||type===UT.KNIGHT||type===UT.PALADIN){
    px(cx,cxp-S*0.22,torsoY+S*0.02,S*0.1,S*0.22, enemy?'#7a2020':'#2c5aa0');
    px(cx,cxp-S*0.2,torsoY+S*0.06,S*0.06,S*0.06,'#e8c84a'); // blason central
    px(cx,cxp-S*0.195,torsoY+S*0.045,S*0.03,Math.max(1,S*0.09),enemy?'#5a1414':'#173a5a'); // croix du blason
    px(cx,cxp-S*0.225,torsoY+S*0.075,Math.max(1,S*0.09),S*0.03,enemy?'#5a1414':'#173a5a');
  }
  return {c,cx,S:S/SS};
}

// Gibier sauvage (Cerf/Sanglier) : jusqu'ici rendu par un simple ctx.fillText
// de l'emoji WILDLIFE_DEF[type].ico, à la taille d'une unité entière — le
// seul endroit du monde de jeu où la faune tranchait avec le reste du pixel
// art fait main. Même squelette quadrupède que drawHorse(), redimensionné.
function buildWildlifeSprite(type,T){
  const S=Math.round(T*0.62);
  const{c,cx}=offCanvas(S,S);
  const cxp=S/2, gy=S*0.6;
  cx.fillStyle='rgba(0,0,0,.22)';
  cx.beginPath(); cx.ellipse(cxp,S*0.82,S*0.22,S*0.05,0,0,Math.PI*2); cx.fill();
  if(type==='boar'){
    // Tout était peint dans deux bruns sombres très proches (#5a4a3a et sa
    // version -24) : à 62 % d'une case, le sanglier n'était qu'une tache
    // sombre informe — contrairement au cerf, lisible grâce à son ventre
    // clair et à ses bois. On lui donne ici les mêmes appuis : une robe plus
    // claire, une crête de soies contrastée, un groin clair, et surtout une
    // tête ET une défense assez grandes pour se voir.
    const col='#6f5a44', dk=shade(col,-32), lt=shade(col,22), soie=shade(col,-46);
    for(const ox of [-0.15,-0.05]) px(cx,cxp+ox*S,gy-S*0.02,S*0.055,S*0.2,dk);   // pattes éloignées
    px(cx,cxp-0.24*S,gy-S*0.17,S*0.44,S*0.22,col);                   // corps trapu
    px(cx,cxp-0.24*S,gy-S*0.05,S*0.4,Math.max(2,S*0.04),lt);         // flanc éclairé
    px(cx,cxp-0.24*S,gy-S*0.21,S*0.42,Math.max(2,S*0.05),soie);      // crête de soies hérissées
    for(let k=0;k<5;k++) px(cx,cxp+(-0.2+k*0.09)*S,gy-S*0.26,Math.max(1,S*0.025),S*0.06,soie); // épis dressés
    for(const ox of [0.06,0.16]) px(cx,cxp+ox*S,gy-S*0.02,S*0.06,S*0.2,shade(col,-20)); // pattes proches
    px(cx,cxp+0.16*S,gy-S*0.26,S*0.16,S*0.17,col);                   // tête, nettement agrandie
    px(cx,cxp+0.28*S,gy-S*0.2,S*0.09,S*0.08,lt);                     // groin clair : repère de museau
    px(cx,cxp+0.30*S,gy-S*0.18,Math.max(1,S*0.03),Math.max(1,S*0.03),dk); // narine
    cx.fillStyle='#f0e8d8';                                          // défense recourbée
    cx.beginPath();
    cx.moveTo(cxp+0.27*S,gy-S*0.15); cx.quadraticCurveTo(cxp+0.32*S,gy-S*0.2,cxp+0.30*S,gy-S*0.27);
    cx.lineTo(cxp+0.27*S,gy-S*0.26); cx.quadraticCurveTo(cxp+0.28*S,gy-S*0.2,cxp+0.25*S,gy-S*0.15);
    cx.closePath(); cx.fill();
    px(cx,cxp+0.14*S,gy-S*0.33,S*0.06,S*0.08,soie);                  // oreille
    px(cx,cxp+0.235*S,gy-S*0.235,Math.max(1,S*0.035),Math.max(1,S*0.035),'#120e0a'); // œil
    px(cx,cxp-0.28*S,gy-S*0.08,S*0.05,S*0.11,soie);                  // petite queue
  } else { // deer (par défaut)
    const col='#a9784a', dk=shade(col,-24), lt=shade(col,20);
    for(const ox of [-0.16,-0.07,0.06,0.15]) px(cx,cxp+ox*S,gy,S*0.045,S*0.22,dk);
    px(cx,cxp-0.2*S,gy-S*0.14,S*0.4,S*0.18,col);                     // corps élancé
    px(cx,cxp-0.2*S,gy-S*0.14,S*0.4,Math.max(2,S*0.035),lt);         // reflet dorsal
    px(cx,cxp-0.14*S,gy,S*0.28,S*0.05,'#e8d8b8');                    // ventre clair
    px(cx,cxp+0.14*S,gy-S*0.3,S*0.09,S*0.2,col);                     // encolure
    px(cx,cxp+0.19*S,gy-S*0.4,S*0.12,S*0.11,col);                    // tête
    cx.strokeStyle=dk; cx.lineWidth=Math.max(1,S*0.02);              // bois (silhouette à 2 branches)
    cx.beginPath();
    cx.moveTo(cxp+0.22*S,gy-S*0.4); cx.lineTo(cxp+0.2*S,gy-S*0.52); cx.lineTo(cxp+0.24*S,gy-S*0.58);
    cx.moveTo(cxp+0.2*S,gy-S*0.52); cx.lineTo(cxp+0.16*S,gy-S*0.56);
    cx.moveTo(cxp+0.28*S,gy-S*0.4); cx.lineTo(cxp+0.3*S,gy-S*0.52); cx.lineTo(cxp+0.34*S,gy-S*0.58);
    cx.moveTo(cxp+0.3*S,gy-S*0.52); cx.lineTo(cxp+0.34*S,gy-S*0.55);
    cx.stroke();
    px(cx,cxp+0.34*S,gy-S*0.36,Math.max(1,S*0.035),Math.max(1,S*0.05),'#1a1410'); // œil
    px(cx,cxp-0.24*S,gy-S*0.1,S*0.05,S*0.14,dk);                     // queue
  }
  return {c,cx,S:S/SS};
}
function buildWildlife(T){
  SPR.wildlife={};
  for(const type of Object.keys(WILDLIFE_DEF)) SPR.wildlife[type]=buildWildlifeSprite(type,T);
}

// ═══════════════════════════════════════════════════════════
//  ICÔNES UI (pixel art, remplacent les emojis dans l'UI
//  persistante : topbar, badges, boutons, panneau recherche).
//  Générées UNE fois (taille fixe, indépendante du zoom/TILE),
//  contrairement aux sprites du monde qui se reconstruisent au
//  changement d'échelle.
// ═══════════════════════════════════════════════════════════
const ICS=64; // résolution interne des icônes (crédit statique : nette une fois mise à l'échelle en HTML)
function buildIcons(){
  if(SPR.iconsBuilt) return;
  SPR.ico={};
  const mk=(key,draw)=>{
    const{c,cx}=offCanvas(ICS,ICS);
    draw(cx,ICS);
    SPR.ico[key]={c,cx};
  };
  const S=ICS;

  mk('food',(cx,S)=>{ // miche de pain
    cx.fillStyle='#c98a3c';
    cx.beginPath(); cx.ellipse(S*0.5,S*0.58,S*0.36,S*0.26,0,0,Math.PI*2); cx.fill();
    cx.fillStyle='#e8ac5e';
    cx.beginPath(); cx.ellipse(S*0.5,S*0.5,S*0.3,S*0.2,0,Math.PI,0); cx.fill();
    cx.strokeStyle='rgba(90,50,10,.5)'; cx.lineWidth=Math.max(1,S*0.035);
    for(const dx of [-0.14,0,0.14]){ cx.beginPath(); cx.moveTo(S*0.5+dx*S,S*0.34); cx.lineTo(S*0.5+dx*S+S*0.06,S*0.5); cx.stroke(); }
  });

  mk('wood',(cx,S)=>{ // bûche
    cx.fillStyle='#8a5a2c'; cx.fillRect(S*0.1,S*0.36,S*0.8,S*0.34);
    cx.fillStyle='rgba(0,0,0,.18)'; cx.fillRect(S*0.1,S*0.6,S*0.8,S*0.1);
    for(const col of [['#c99a68',S*0.1],['#b8845a',S*0.86]]){
      cx.fillStyle=col[0]; cx.beginPath(); cx.ellipse(col[1],S*0.53,S*0.09,S*0.19,0,0,Math.PI*2); cx.fill();
      cx.strokeStyle='rgba(90,55,20,.55)'; cx.lineWidth=1;
      cx.beginPath(); cx.ellipse(col[1],S*0.53,S*0.05,S*0.1,0,0,Math.PI*2); cx.stroke();
    }
  });

  mk('stone',(cx,S)=>{ // rocher facetté
    cx.fillStyle='rgba(0,0,0,.2)'; cx.beginPath(); cx.ellipse(S*0.5,S*0.82,S*0.32,S*0.06,0,0,Math.PI*2); cx.fill();
    const rock=(ox,oy,r,c1,c2)=>{
      cx.fillStyle=c1; cx.beginPath(); cx.ellipse(S*0.5+ox,S*0.6+oy,r,r*0.8,0,0,Math.PI*2); cx.fill();
      cx.fillStyle=c2; cx.beginPath(); cx.ellipse(S*0.5+ox-r*0.3,S*0.6+oy-r*0.25,r*0.5,r*0.35,0,0,Math.PI*2); cx.fill();
    };
    rock(-S*0.12,0,S*0.22,'#6e6e76','#9a9aa2');
    rock(S*0.13,S*0.03,S*0.18,'#7a7a82','#a8a8b0');
    rock(0,-S*0.14,S*0.15,'#8a8a92','#c2c2c8');
  });

  mk('gold',(cx,S)=>{ // pièce
    cx.fillStyle='#8b6914'; cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.36,0,Math.PI*2); cx.fill();
    cx.fillStyle='#f0c040'; cx.beginPath(); cx.arc(S*0.5,S*0.48,S*0.34,0,Math.PI*2); cx.fill();
    cx.strokeStyle='#d4a017'; cx.lineWidth=Math.max(1,S*0.03);
    cx.beginPath(); cx.arc(S*0.5,S*0.48,S*0.24,0,Math.PI*2); cx.stroke();
    cx.fillStyle='rgba(255,255,255,.55)';
    cx.beginPath(); cx.ellipse(S*0.4,S*0.36,S*0.08,S*0.04,-0.4,0,Math.PI*2); cx.fill();
  });

  mk('pop',(cx,S)=>{ // villageois (silhouette)
    cx.fillStyle='#e0b088'; cx.beginPath(); cx.arc(S*0.5,S*0.32,S*0.16,0,Math.PI*2); cx.fill();
    cx.fillStyle='#8a6a3a';
    cx.beginPath(); cx.moveTo(S*0.28,S*0.86); cx.lineTo(S*0.36,S*0.46); cx.lineTo(S*0.64,S*0.46); cx.lineTo(S*0.72,S*0.86); cx.closePath(); cx.fill();
    cx.fillStyle='rgba(255,255,255,.18)'; cx.beginPath(); cx.moveTo(S*0.4,S*0.48); cx.lineTo(S*0.44,S*0.8); cx.lineTo(S*0.36,S*0.8); cx.closePath(); cx.fill();
  });

  mk('home',(cx,S)=>{ // maison
    cx.fillStyle='#8a5424'; cx.beginPath(); cx.moveTo(S*0.5,S*0.16); cx.lineTo(S*0.86,S*0.46); cx.lineTo(S*0.14,S*0.46); cx.closePath(); cx.fill();
    cx.fillStyle='#9a7a4a'; cx.fillRect(S*0.24,S*0.46,S*0.52,S*0.38);
    cx.fillStyle='rgba(0,0,0,.25)'; cx.fillRect(S*0.24,S*0.76,S*0.52,S*0.08);
    cx.fillStyle='#4a2e10'; cx.fillRect(S*0.45,S*0.6,S*0.1,S*0.24);
  });

  mk('sword',(cx,S)=>{ // épée
    cx.fillStyle='#cfcfd6';
    cx.beginPath(); cx.moveTo(S*0.5,S*0.1); cx.lineTo(S*0.6,S*0.24); cx.lineTo(S*0.58,S*0.62); cx.lineTo(S*0.42,S*0.62); cx.lineTo(S*0.4,S*0.24); cx.closePath(); cx.fill();
    cx.fillStyle='rgba(255,255,255,.4)'; cx.fillRect(S*0.47,S*0.24,S*0.04,S*0.34);
    cx.fillStyle='#caa83a'; cx.fillRect(S*0.28,S*0.6,S*0.44,S*0.07);
    cx.fillStyle='#6a4a24'; cx.fillRect(S*0.46,S*0.67,S*0.08,S*0.2);
  });

  mk('horse',(cx,S)=>{ // tête de cheval
    cx.fillStyle='#7a4f2c';
    cx.beginPath();
    cx.moveTo(S*0.3,S*0.78); cx.quadraticCurveTo(S*0.24,S*0.5,S*0.4,S*0.34);
    cx.quadraticCurveTo(S*0.46,S*0.2,S*0.62,S*0.22);
    cx.quadraticCurveTo(S*0.74,S*0.24,S*0.76,S*0.36);
    cx.quadraticCurveTo(S*0.66,S*0.4,S*0.64,S*0.48);
    cx.quadraticCurveTo(S*0.7,S*0.6,S*0.62,S*0.78);
    cx.closePath(); cx.fill();
    cx.fillStyle='#5a3a1c'; cx.beginPath(); cx.moveTo(S*0.56,S*0.2); cx.lineTo(S*0.62,S*0.08); cx.lineTo(S*0.64,S*0.22); cx.closePath(); cx.fill();
    cx.fillStyle='#1a1410'; cx.beginPath(); cx.arc(S*0.58,S*0.34,S*0.035,0,Math.PI*2); cx.fill();
  });

  mk('cross',(cx,S)=>{ // croix
    cx.fillStyle='#e8d5a0';
    cx.fillRect(S*0.44,S*0.14,S*0.12,S*0.72);
    cx.fillRect(S*0.24,S*0.34,S*0.52,S*0.12);
    cx.fillStyle='rgba(0,0,0,.15)';
    cx.fillRect(S*0.44,S*0.14,S*0.05,S*0.72);
  });

  mk('univ',(cx,S)=>{ // toque universitaire
    cx.fillStyle='#2c6e8a';
    cx.beginPath(); cx.moveTo(S*0.5,S*0.24); cx.lineTo(S*0.86,S*0.4); cx.lineTo(S*0.5,S*0.56); cx.lineTo(S*0.14,S*0.4); cx.closePath(); cx.fill();
    cx.fillStyle='#1a4a5a'; cx.fillRect(S*0.4,S*0.4,S*0.2,S*0.28);
    cx.fillStyle='#caa83a'; cx.beginPath(); cx.arc(S*0.5,S*0.72,S*0.045,0,Math.PI*2); cx.fill();
    cx.strokeStyle='#caa83a'; cx.lineWidth=Math.max(1,S*0.025);
    cx.beginPath(); cx.moveTo(S*0.8,S*0.38); cx.lineTo(S*0.5,S*0.5); cx.lineTo(S*0.5,S*0.72); cx.stroke();
  });

  mk('tower',(cx,S)=>{ // tour
    cx.fillStyle='#7a6a4a'; cx.fillRect(S*0.3,S*0.28,S*0.4,S*0.58);
    cx.fillStyle='rgba(0,0,0,.2)'; cx.fillRect(S*0.62,S*0.28,S*0.08,S*0.58);
    for(let k=0;k<3;k++) cx.fillRect(S*0.3+k*S*0.15,S*0.16,S*0.09,S*0.12);
    cx.fillStyle='#3a2f1c'; cx.fillRect(S*0.42,S*0.62,S*0.16,S*0.24);
  });

  mk('castle',(cx,S)=>{ // château
    cx.fillStyle='#888878'; cx.fillRect(S*0.18,S*0.4,S*0.64,S*0.46);
    cx.fillStyle='#6a6a5a'; cx.fillRect(S*0.12,S*0.24,S*0.18,S*0.62);
    cx.fillRect(S*0.7,S*0.24,S*0.18,S*0.62);
    for(const bx of [0.12,0.2,0.7,0.78]) cx.fillRect(S*bx,S*0.18,S*0.1,S*0.08);
    cx.fillStyle='#caa83a'; cx.fillRect(S*0.48,S*0.06,S*0.04,S*0.2);
    cx.fillStyle='#8b1a1a'; cx.fillRect(S*0.52,S*0.08,S*0.16,S*0.1);
    cx.fillStyle='#2a1c0c'; cx.fillRect(S*0.42,S*0.64,S*0.16,S*0.22);
  });

  mk('mine',(cx,S)=>{ // pioche
    cx.strokeStyle='#6a4a26'; cx.lineWidth=Math.max(2,S*0.07);
    cx.beginPath(); cx.moveTo(S*0.28,S*0.82); cx.lineTo(S*0.68,S*0.24); cx.stroke();
    cx.fillStyle='#9a9aa2';
    cx.beginPath(); cx.moveTo(S*0.48,S*0.16); cx.quadraticCurveTo(S*0.82,S*0.16,S*0.86,S*0.4); cx.quadraticCurveTo(S*0.62,S*0.34,S*0.48,S*0.16); cx.closePath(); cx.fill();
    cx.beginPath(); cx.moveTo(S*0.48,S*0.16); cx.quadraticCurveTo(S*0.18,S*0.14,S*0.14,S*0.36); cx.quadraticCurveTo(S*0.38,S*0.34,S*0.48,S*0.16); cx.closePath(); cx.fill();
  });

  mk('farm',(cx,S)=>{ // gerbe de blé
    cx.strokeStyle='#caa83a'; cx.lineWidth=Math.max(1.5,S*0.045);
    for(const dx of [-0.14,0,0.14]){
      cx.beginPath(); cx.moveTo(S*0.5+dx*S,S*0.8); cx.lineTo(S*0.5+dx*0.6*S,S*0.2); cx.stroke();
    }
    cx.fillStyle='#d9b23c';
    for(const dx of [-0.14,0,0.14]) for(let k=0;k<4;k++){
      const yy=S*0.24+k*S*0.1, xx=S*0.5+dx*0.6*S*(1-k*0.22);
      cx.beginPath(); cx.ellipse(xx,yy,S*0.05,S*0.08,dx,0,Math.PI*2); cx.fill();
    }
    cx.fillStyle='#8a6a3a'; cx.fillRect(S*0.4,S*0.66,S*0.2,S*0.08);
  });

  mk('mill',(cx,S)=>{ // ailes de moulin
    cx.fillStyle='#3a2818'; cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.06,0,Math.PI*2); cx.fill();
    const sail=(ang)=>{
      cx.save(); cx.translate(S*0.5,S*0.5); cx.rotate(ang);
      cx.fillStyle='#e8d9b0'; cx.fillRect(S*0.04,-S*0.05,S*0.34,S*0.1);
      cx.restore();
    };
    sail(0); sail(Math.PI/2); sail(Math.PI); sail(-Math.PI/2);
  });

  mk('market',(cx,S)=>{ // auvent
    cx.fillStyle='#8a6a3a'; cx.fillRect(S*0.44,S*0.3,S*0.06,S*0.5);
    const st=6,sw=S*0.7/st;
    for(let k=0;k<st;k++){
      cx.fillStyle=k%2?'#e8e0d0':'#c0392b';
      cx.beginPath(); cx.moveTo(S*0.15+k*sw,S*0.3); cx.lineTo(S*0.15+(k+1)*sw,S*0.3); cx.lineTo(S*0.15+(k+0.7)*sw,S*0.44); cx.lineTo(S*0.15+(k+0.3)*sw,S*0.44); cx.closePath(); cx.fill();
    }
  });

  mk('forge',(cx,S)=>{ // enclume
    cx.fillStyle='#484848';
    cx.fillRect(S*0.26,S*0.42,S*0.48,S*0.14);
    cx.fillRect(S*0.4,S*0.56,S*0.2,S*0.14);
    cx.fillRect(S*0.32,S*0.7,S*0.36,S*0.08);
    cx.fillStyle='#ff8a2a'; cx.beginPath(); cx.arc(S*0.68,S*0.36,S*0.05,0,Math.PI*2); cx.fill();
    cx.fillStyle='rgba(255,170,60,.5)'; cx.beginPath(); cx.arc(S*0.72,S*0.28,S*0.04,0,Math.PI*2); cx.fill();
  });

  mk('bow',(cx,S)=>{ // arc + flèche
    cx.strokeStyle='#8a5a2a'; cx.lineWidth=Math.max(2,S*0.06);
    cx.beginPath(); cx.arc(S*0.36,S*0.5,S*0.32,-1.1,1.1); cx.stroke();
    cx.strokeStyle='#caa060'; cx.lineWidth=1;
    cx.beginPath(); cx.moveTo(S*0.5,S*0.2); cx.lineTo(S*0.5,S*0.8); cx.stroke();
    cx.strokeStyle='#6a4a24'; cx.lineWidth=Math.max(1.5,S*0.04);
    cx.beginPath(); cx.moveTo(S*0.24,S*0.5); cx.lineTo(S*0.68,S*0.5); cx.stroke();
    cx.fillStyle='#cfcfd6'; cx.beginPath(); cx.moveTo(S*0.68,S*0.5); cx.lineTo(S*0.58,S*0.44); cx.lineTo(S*0.58,S*0.56); cx.closePath(); cx.fill();
  });

  mk('pike',(cx,S)=>{ // pique
    cx.strokeStyle='#6a4a24'; cx.lineWidth=Math.max(2,S*0.055);
    cx.beginPath(); cx.moveTo(S*0.24,S*0.82); cx.lineTo(S*0.68,S*0.22); cx.stroke();
    cx.fillStyle='#cfcfd6';
    cx.beginPath(); cx.moveTo(S*0.68,S*0.22); cx.lineTo(S*0.82,S*0.32); cx.lineTo(S*0.6,S*0.36); cx.closePath(); cx.fill();
  });

  mk('target',(cx,S)=>{ // cible
    cx.fillStyle='#c0392b'; cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.34,0,Math.PI*2); cx.fill();
    cx.fillStyle='#e8e0d0'; cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.23,0,Math.PI*2); cx.fill();
    cx.fillStyle='#c0392b'; cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.12,0,Math.PI*2); cx.fill();
  });

  mk('star',(cx,S)=>{ // étoile
    cx.fillStyle='#f0c040';
    cx.beginPath();
    for(let i=0;i<10;i++){
      const r=i%2===0?S*0.36:S*0.15, a=-Math.PI/2+i*Math.PI/5;
      const x=S*0.5+Math.cos(a)*r, y=S*0.5+Math.sin(a)*r;
      i===0?cx.moveTo(x,y):cx.lineTo(x,y);
    }
    cx.closePath(); cx.fill();
  });

  mk('shield',(cx,S)=>{ // bouclier
    cx.fillStyle='#7a8a9a';
    cx.beginPath(); cx.moveTo(S*0.5,S*0.14); cx.lineTo(S*0.82,S*0.26); cx.lineTo(S*0.78,S*0.6); cx.quadraticCurveTo(S*0.7,S*0.84,S*0.5,S*0.9); cx.quadraticCurveTo(S*0.3,S*0.84,S*0.22,S*0.6); cx.lineTo(S*0.18,S*0.26); cx.closePath(); cx.fill();
    cx.lineWidth=Math.max(1.5,S*0.04); cx.strokeStyle='#caa83a';
    cx.beginPath(); cx.moveTo(S*0.5,S*0.22); cx.lineTo(S*0.5,S*0.72); cx.moveTo(S*0.3,S*0.42); cx.lineTo(S*0.7,S*0.42); cx.stroke();
  });

  mk('brick',(cx,S)=>{ // mur de briques
    const rows=4,cols=3,bw=S*0.8/cols,bh=S*0.7/rows;
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
      const off=(r%2)*bw*0.5;
      cx.fillStyle='#a0522d';
      cx.fillRect(S*0.1+c*bw+off-bw*0.5,S*0.15+r*bh,bw*0.92,bh*0.85);
    }
    cx.strokeStyle='rgba(0,0,0,.25)'; cx.lineWidth=1;
    cx.strokeRect(S*0.1,S*0.15,S*0.8,S*0.7);
  });

  mk('scroll',(cx,S)=>{ // parchemin roulé
    cx.fillStyle='#e8d5a0'; cx.fillRect(S*0.2,S*0.3,S*0.6,S*0.4);
    cx.fillStyle='#c8a96e';
    cx.beginPath(); cx.ellipse(S*0.2,S*0.5,S*0.08,S*0.22,0,0,Math.PI*2); cx.fill();
    cx.beginPath(); cx.ellipse(S*0.8,S*0.5,S*0.08,S*0.22,0,0,Math.PI*2); cx.fill();
    cx.strokeStyle='rgba(90,60,20,.4)'; cx.lineWidth=1;
    for(const y of [0.4,0.48,0.56]){ cx.beginPath(); cx.moveTo(S*0.3,S*y); cx.lineTo(S*0.7,S*y); cx.stroke(); }
  });

  mk('wrench',(cx,S)=>{ // clé
    cx.strokeStyle='#8a8a92'; cx.lineWidth=Math.max(3,S*0.14); cx.lineCap='round';
    cx.beginPath(); cx.moveTo(S*0.28,S*0.78); cx.lineTo(S*0.62,S*0.42); cx.stroke();
    cx.fillStyle='#8a8a92'; cx.beginPath(); cx.arc(S*0.72,S*0.3,S*0.16,0,Math.PI*2); cx.fill();
    cx.fillStyle='rgba(0,0,0,.55)'; cx.beginPath(); cx.arc(S*0.72,S*0.3,S*0.07,0,Math.PI*2); cx.fill();
  });

  // Trois icônes de recherche (Forge de Siège 🐏, Lance de Cavalerie 🗡️,
  // Logistique 🥾) manquaient à ICO_KEY : sans entrée pixel art, iconImg()
  // dégradait silencieusement vers l'emoji brut — visible seulement en
  // ouvrant le panneau Forge/Université, mêlé aux icônes dessinées voisines.
  mk('ram',(cx,S)=>{ // tête de bélier
    cx.fillStyle='#8a8a92';
    cx.beginPath(); cx.ellipse(S*0.5,S*0.56,S*0.22,S*0.26,0,0,Math.PI*2); cx.fill();
    cx.fillStyle='#6a6a72';
    cx.beginPath(); cx.ellipse(S*0.5,S*0.78,S*0.12,S*0.1,0,0,Math.PI*2); cx.fill();
    cx.strokeStyle='#e8d5a0'; cx.lineWidth=Math.max(2,S*0.06); cx.lineCap='round';
    cx.beginPath(); cx.moveTo(S*0.34,S*0.42); cx.quadraticCurveTo(S*0.12,S*0.46,S*0.16,S*0.68); cx.stroke();
    cx.beginPath(); cx.moveTo(S*0.66,S*0.42); cx.quadraticCurveTo(S*0.88,S*0.46,S*0.84,S*0.68); cx.stroke();
    cx.fillStyle='#1a1410';
    cx.beginPath(); cx.arc(S*0.4,S*0.5,S*0.035,0,Math.PI*2); cx.fill();
    cx.beginPath(); cx.arc(S*0.6,S*0.5,S*0.035,0,Math.PI*2); cx.fill();
  });

  mk('lance',(cx,S)=>{ // lance de cavalerie, fanion
    cx.strokeStyle='#6a4a24'; cx.lineWidth=Math.max(2,S*0.05);
    cx.beginPath(); cx.moveTo(S*0.2,S*0.86); cx.lineTo(S*0.74,S*0.16); cx.stroke();
    cx.fillStyle='#cfcfd6';
    cx.beginPath(); cx.moveTo(S*0.74,S*0.16); cx.lineTo(S*0.88,S*0.28); cx.lineTo(S*0.64,S*0.32); cx.closePath(); cx.fill();
    cx.fillStyle='#c0392b';
    cx.beginPath(); cx.moveTo(S*0.5,S*0.42); cx.lineTo(S*0.32,S*0.36); cx.lineTo(S*0.44,S*0.52); cx.closePath(); cx.fill();
  });

  mk('boots',(cx,S)=>{ // botte de marche
    cx.fillStyle='#6a4a28';
    cx.beginPath();
    cx.moveTo(S*0.38,S*0.14); cx.lineTo(S*0.58,S*0.14); cx.lineTo(S*0.58,S*0.56);
    cx.quadraticCurveTo(S*0.78,S*0.6,S*0.84,S*0.74);
    cx.lineTo(S*0.84,S*0.82); cx.lineTo(S*0.2,S*0.82); cx.lineTo(S*0.2,S*0.68);
    cx.lineTo(S*0.38,S*0.6);
    cx.closePath(); cx.fill();
    cx.fillStyle='#4a3018'; cx.fillRect(S*0.2,S*0.74,S*0.64,S*0.08);
    cx.strokeStyle='rgba(0,0,0,.25)'; cx.lineWidth=1;
    cx.beginPath(); cx.moveTo(S*0.38,S*0.3); cx.lineTo(S*0.58,S*0.3); cx.stroke();
  });

  mk('pause',(cx,S)=>{
    cx.fillStyle='#f0c040';
    cx.fillRect(S*0.28,S*0.2,S*0.16,S*0.6); cx.fillRect(S*0.56,S*0.2,S*0.16,S*0.6);
  });

  mk('play',(cx,S)=>{
    cx.fillStyle='#f0c040';
    cx.beginPath(); cx.moveTo(S*0.32,S*0.18); cx.lineTo(S*0.32,S*0.82); cx.lineTo(S*0.8,S*0.5); cx.closePath(); cx.fill();
  });

  mk('sound-on',(cx,S)=>{
    cx.fillStyle='#f0c040';
    cx.beginPath(); cx.moveTo(S*0.18,S*0.4); cx.lineTo(S*0.34,S*0.4); cx.lineTo(S*0.5,S*0.24); cx.lineTo(S*0.5,S*0.76); cx.lineTo(S*0.34,S*0.6); cx.lineTo(S*0.18,S*0.6); cx.closePath(); cx.fill();
    cx.strokeStyle='#f0c040'; cx.lineWidth=Math.max(1.5,S*0.045);
    cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.2,-0.6,0.6); cx.stroke();
    cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.32,-0.6,0.6); cx.stroke();
  });

  mk('sound-off',(cx,S)=>{
    cx.fillStyle='#888';
    cx.beginPath(); cx.moveTo(S*0.18,S*0.4); cx.lineTo(S*0.34,S*0.4); cx.lineTo(S*0.5,S*0.24); cx.lineTo(S*0.5,S*0.76); cx.lineTo(S*0.34,S*0.6); cx.lineTo(S*0.18,S*0.6); cx.closePath(); cx.fill();
    cx.strokeStyle='#c0392b'; cx.lineWidth=Math.max(1.5,S*0.06);
    cx.beginPath(); cx.moveTo(S*0.58,S*0.36); cx.lineTo(S*0.78,S*0.64); cx.moveTo(S*0.78,S*0.36); cx.lineTo(S*0.58,S*0.64); cx.stroke();
  });

  mk('moon',(cx,S)=>{ // âge sombre
    cx.fillStyle='#c9c9d4'; cx.beginPath(); cx.arc(S*0.5,S*0.5,S*0.32,0,Math.PI*2); cx.fill();
    cx.fillStyle='#140c00'; cx.beginPath(); cx.arc(S*0.62,S*0.42,S*0.28,0,Math.PI*2); cx.fill();
  });

  mk('dawn',(cx,S)=>{ // âge féodal
    cx.fillStyle='#f0c040'; cx.beginPath(); cx.arc(S*0.5,S*0.58,S*0.26,Math.PI,0); cx.fill();
    cx.strokeStyle='#f0c040'; cx.lineWidth=Math.max(1.5,S*0.04);
    for(const a of [-1.3,-0.9,0.9,1.3]){ cx.beginPath(); cx.moveTo(S*0.5+Math.cos(a)*S*0.3,S*0.58+Math.sin(a)*S*0.3); cx.lineTo(S*0.5+Math.cos(a)*S*0.4,S*0.58+Math.sin(a)*S*0.4); cx.stroke(); }
    cx.strokeStyle='#8b6914'; cx.lineWidth=Math.max(1.5,S*0.045);
    cx.beginPath(); cx.moveTo(S*0.1,S*0.74); cx.lineTo(S*0.9,S*0.74); cx.stroke();
  });

  mk('crown',(cx,S)=>{ // âge impérial
    cx.fillStyle='#f0c040';
    cx.beginPath(); cx.moveTo(S*0.18,S*0.7); cx.lineTo(S*0.18,S*0.42); cx.lineTo(S*0.32,S*0.56); cx.lineTo(S*0.5,S*0.28); cx.lineTo(S*0.68,S*0.56); cx.lineTo(S*0.82,S*0.42); cx.lineTo(S*0.82,S*0.7); cx.closePath(); cx.fill();
    cx.fillStyle='#8b6914'; cx.fillRect(S*0.16,S*0.7,S*0.68,S*0.08);
    cx.fillStyle='#c0392b'; cx.beginPath(); cx.arc(S*0.5,S*0.56,S*0.045,0,Math.PI*2); cx.fill();
  });

  mk('hourglass',(cx,S)=>{ // avancement d'âge en cours
    cx.fillStyle='#caa83a';
    cx.beginPath(); cx.moveTo(S*0.26,S*0.18); cx.lineTo(S*0.74,S*0.18); cx.lineTo(S*0.52,S*0.5); cx.lineTo(S*0.74,S*0.82); cx.lineTo(S*0.26,S*0.82); cx.lineTo(S*0.48,S*0.5); cx.closePath(); cx.fill();
    cx.fillStyle='#3a2818'; cx.fillRect(S*0.22,S*0.14,S*0.56,S*0.06); cx.fillRect(S*0.22,S*0.8,S*0.56,S*0.06);
  });

  SPR.iconsBuilt=true;
}

// ── SURCOUCHE : icônes de ressources illustrées, en amélioration ──────
// progressive par-dessus les icônes procédurales ci-dessus. Chargement
// asynchrone depuis assets/ressources/ : si le fichier est absent (jeu
// ouvert en file:// sans serveur, dossier pas encore fourni, ou canvas
// « taint » par la politique CORS locale) l'échec est silencieux et
// l'icône procédurale déjà dessinée plus haut reste utilisée telle
// quelle — aucune régression possible.
const RES_SPRITE_FILES={food:'nourriture',wood:'bois',stone:'pierre',gold:'or'};

// Détoure un fond quasi-blanc par flood fill depuis les bords (au lieu
// d'un simple seuil global, pour ne pas manger les zones claires à
// l'intérieur du sujet), et renvoie à la fois le canvas détouré (à la
// résolution de travail W×H) et la boîte englobante du contenu restant —
// réutilisé aussi bien pour les icônes (recadrage carré) que pour les
// bâtiments (recadrage « contain » ancré en bas). Partagé pour que les deux
// usages détourent exactement de la même façon.
// Le résultat ne dépend QUE de (image source, résolution de travail) — jamais
// du zoom. Or buildSprites() est rejoué à chaque changement d'échelle et
// refaisait donc l'intégralité des flood fills : ~1,25 s de JS bloquant à
// chaque cran de molette, soit exactement les « gros lags au zoom ». Le
// cache ci-dessous ramène ce coût à zéro dès la deuxième génération.
//
// On y range la version DÉJÀ RECADRÉE sur le contenu : c'est la seule qui
// serve à quoi que ce soit, et elle pèse bien moins lourd que la planche
// entière. minX/minY restent dans le résultat (à zéro) pour que les appelants
// gardent leur drawImage à neuf arguments inchangé.
const TRIM_CACHE=new Map();

// `src` accepte aussi bien une <img> décodée qu'une simple URL : une fois le
// détourage en cache, l'URL suffit à le retrouver et l'image source peut être
// relâchée (voir withIllustration). Renvoie null si l'URL n'a pas encore été
// détourée — l'appelant conserve alors son sprite procédural.
//
// `cle` est l'URL TELLE QUE L'APPELANT L'ÉCRIT (relative). S'en remettre à
// img.src rangerait l'entrée sous l'URL absolue résolue par le navigateur
// (http://hôte/assets/…), que les relectures ultrérieures — qui ne
// disposent plus que du chemin relatif — ne retrouveraient jamais.
function stripBgTrimmed(src,W,cle){
  W=Math.max(16,Math.round(W));
  const url=cle||((typeof src==='string')?src:src.src);
  const key=url+'@'+W;
  const hit=TRIM_CACHE.get(key);
  if(hit) return hit;
  if(typeof src==='string'||!src.width) return null;
  const res=computeStripBgTrimmed(src,W);
  TRIM_CACHE.set(key,res);
  return res;
}

function computeStripBgTrimmed(img,W){
  const H=Math.max(1,Math.round(W*img.height/img.width));
  const{c:wc,cx:wcx}=offCanvas(W,H);
  wcx.drawImage(img,0,0,W,H);
  const id=wcx.getImageData(0,0,W,H);
  const d=id.data;
  const N=W*H;
  // État par pixel : 0 = sujet, 1 = fond candidat, 2 = fond atteint depuis un
  // bord. Le test de couleur est fait UNE fois pour toute l'image plutôt
  // qu'à chaque visite du flood fill.
  const st=new Uint8Array(N);
  for(let i=0,q=0;i<N;i++,q+=4){
    const r=d[q],g=d[q+1],b=d[q+2];
    if(r>230&&g>230&&b>230&&Math.abs(r-g)<12&&Math.abs(g-b)<12) st[i]=1;
  }
  // Pile d'entiers de taille bornée (chaque pixel y entre au plus une fois)
  // au lieu du tableau JS d'origine, qui recevait huit valeurs par pixel
  // visité : sur une planche de 600×900 cela montait à plusieurs millions
  // d'entrées, avec le pic mémoire — et le risque de plantage — qui va avec.
  const stack=new Int32Array(N);
  let sp=0;
  for(let x=0;x<W;x++){
    if(st[x]===1){ st[x]=2; stack[sp++]=x; }
    const j=(H-1)*W+x;
    if(st[j]===1){ st[j]=2; stack[sp++]=j; }
  }
  for(let y=0;y<H;y++){
    const a=y*W, b=a+W-1;
    if(st[a]===1){ st[a]=2; stack[sp++]=a; }
    if(st[b]===1){ st[b]=2; stack[sp++]=b; }
  }
  while(sp>0){
    const i=stack[--sp];
    d[i*4+3]=0;
    const x=i%W;
    if(x>0     && st[i-1]===1){ st[i-1]=2; stack[sp++]=i-1; }
    if(x<W-1   && st[i+1]===1){ st[i+1]=2; stack[sp++]=i+1; }
    if(i>=W    && st[i-W]===1){ st[i-W]=2; stack[sp++]=i-W; }
    if(i+W<N   && st[i+W]===1){ st[i+W]=2; stack[sp++]=i+W; }
  }
  wcx.putImageData(id,0,0);
  let minX=W,minY=H,maxX=-1,maxY=-1;
  for(let y=0;y<H;y++){
    const base=y*W;
    let rMin=-1,rMax=-1;
    for(let x=0;x<W;x++){ if(d[(base+x)*4+3]>10){ if(rMin<0)rMin=x; rMax=x; } }
    if(rMin>=0){ if(y<minY)minY=y; maxY=y; if(rMin<minX)minX=rMin; if(rMax>maxX)maxX=rMax; }
  }
  if(maxX<0){ minX=0; minY=0; maxX=W-1; maxY=H-1; }
  const bw=maxX-minX+1, bh=maxY-minY+1;
  // Recadrage immédiat : on ne garde en mémoire que le sujet, pas la marge
  // de fond transparent qui l'entourait.
  const{c,cx}=offCanvas(bw,bh);
  cx.drawImage(wc,minX,minY,bw,bh,0,0,bw,bh);
  return{c,minX:0,minY:0,bw,bh};
}

// ── CHARGEMENT DES ILLUSTRATIONS ─────────────────────────────
// Point de passage unique des six surcouches illustrées (bâtiments, unités,
// gisements, faune, objets uniques, icônes). Une fois le détourage en cache,
// la <img> décodée est RELACHÉE : chaque planche pèse ~4 Mo de bitmap une
// fois décodée, et les conserver toutes (une cinquantaine, soit ~220 Mo)
// suffisait à faire tomber l'onglet sur mobile. Le canvas détouré et recadré
// qui les remplace tient dans une fraction de cette place.
const AI_SRC_STATE={};   // url -> 'pending' | 'ready' | 'error'
function withIllustration(url,W,apply){
  const st=AI_SRC_STATE[url];
  if(st==='error'||st==='pending') return;
  if(st==='ready'){ apply(url); return; }   // détourage déjà en cache : synchrone
  AI_SRC_STATE[url]='pending';
  const img=new Image();
  img.onload=()=>{
    img.onload=img.onerror=null;            // plus personne ne référence l'image
    try{
      stripBgTrimmed(img,W,url);            // remplit TRIM_CACHE une seule fois
      AI_SRC_STATE[url]='ready';
      apply(url);
    }catch(e){ AI_SRC_STATE[url]='error'; } // canvas « taint » : repli procédural
  };
  img.onerror=()=>{ img.onload=img.onerror=null; AI_SRC_STATE[url]='error'; }; // fichier absent : repli procédural
  img.src=url;
}

// Recadre sur le contenu détouré et le centre dans un canvas carré S×S.
function stripBgAndFit(src,S){
  const t=stripBgTrimmed(src,TRIM_W_ICON); if(!t) return null;
  const{c:wc,minX,minY,bw,bh}=t;
  const{c,cx}=offCanvas(S,S);
  const scale=Math.min(S*0.92/bw,S*0.92/bh);
  const dw=bw*scale, dh=bh*scale;
  cx.drawImage(wc,minX,minY,bw,bh,(S-dw)/2,(S-dh)/2,dw,dh);
  return{c,cx};
}

function upgradeResourceIcons(){
  if(SPR.resIconsUpgrading) return;
  SPR.resIconsUpgrading=true;
  for(const key in RES_SPRITE_FILES){
    withIllustration('assets/ressources/'+RES_SPRITE_FILES[key]+ASSET_EXT,TRIM_W_ICON,(url)=>{
      const fitted=stripBgAndFit(url,ICS); if(!fitted) return;
      SPR.ico[key]=fitted;
      applyStaticIcons();
    });
  }
}

// Table de correspondance emoji → clé d'icône dessinée. Portée volontai-
// rement limitée à l'UI PERSISTANTE (topbar, boutons d'action, panneau de
// recherche, barre d'âge) : les emojis dans les notifications, bannières
// et textes flottants de combat restent tels quels — rendu bref, le gain
// visuel d'un remplacement ne justifiait pas de toucher ces dizaines
// d'appels dispersés dans la logique de jeu.
const ICO_KEY = {
  '🍖':'food','🪵':'wood','🪨':'stone','💰':'gold',
  '👥':'pop','👷':'pop',
  '🏠':'home','🏰':'castle','🏯':'castle',
  '⛏️':'mine','🌾':'farm','💨':'mill','🏪':'market','⚒️':'forge',
  '⚔️':'sword','🐴':'horse','⛪':'cross','✝️':'cross','🎓':'univ',
  '🗼':'tower','🏹':'bow','🔱':'pike','🎯':'target','🌟':'star',
  '🛡️':'shield','🧱':'brick','📜':'scroll','🔧':'wrench',
  '🐏':'ram','🗡️':'lance','🥾':'boots',
  '⏸':'pause','▶':'play','🔊':'sound-on','🔇':'sound-off',
  '🌑':'moon','🌅':'dawn','👑':'crown','⏳':'hourglass',
};

// <img> pour l'icône dessinée correspondant à cet emoji, ou l'emoji lui-
// même si aucune icône n'a été dessinée pour lui (dégradation silencieuse).
function iconImg(emoji,size){
  const key=ICO_KEY[emoji];
  const ic=key&&SPR.ico&&SPR.ico[key];
  if(!ic) return emoji;
  if(!ic.url) ic.url=ic.c.toDataURL('image/png');
  return `<img src="${ic.url}" width="${size}" height="${size}" style="vertical-align:middle;display:inline-block;">`;
}

// Injecte les icônes dessinées dans l'UI persistante (topbar, badges,
// raccourcis rapides, menu pause, écran de titre). Idempotent : peut être
// rappelée sans effet de bord (ex. à chaque buildSprites()).
function applyStaticIcons(){
  if(!SPR.iconsBuilt) return;
  const set=(id,emoji,size)=>{ const el=document.getElementById(id); if(el) el.innerHTML=iconImg(emoji,size); };
  set('ico-food','🍖',15); set('ico-wood','🪵',15); set('ico-stone','🪨',15); set('ico-gold','💰',15);
  set('ico-pop','👥',13);
  set('ico-idle','👷',15);
  set('ico-start','🏰',48);
  set('zhome','🏠',19);
  set('zarmy','⚔️',19);
  const zs=document.getElementById('zsound');
  if(zs){
    const on=!(typeof SFX!=='undefined'&&SFX.on===false);
    zs.innerHTML=`${iconImg(on?'🔊':'🔇',18)} Son : ${on?'Activé':'Coupé'}`;
  }
  const pb=document.getElementById('pausebtn-inner');
  if(pb) pb.innerHTML=iconImg((typeof G!=='undefined'&&G.paused)?'▶':'⏸',16);
  // Les icônes viennent de changer : le HUD écrit par différence (voir setTxt)
  // doit oublier ce qu'il croit déjà affiché.
  viderCacheHUD();
}

// Reconstruit tous les sprites (appelé au démarrage et au changement de zoom)
// ── TEINTES DE FACTION ────────────────────────────────────
// Le pixel art ne connaît que deux habillages : celui du joueur et une
// variante rouge. Plutôt que de dupliquer les dizaines de couleurs codées en
// dur pour chaque nouveau camp, on rejoue le sprite rouge à travers une
// rotation de teinte : le résultat reste cohérent (mêmes ombres, mêmes
// contrastes) pour un seul drawImage, généré paresseusement et uniquement
// pour les teintes réellement présentes dans la partie.
const TEINTE_HUE = { bleu:0, rouge:0, vert:118, violet:268 };
function sprTeinte(kind,key,teinte){
  const base=SPR[kind]&&SPR[kind][key];
  const hue=TEINTE_HUE[teinte]||0;
  if(!base||!hue) return base;
  const store=SPR.teintes||(SPR.teintes={});
  const parTeinte=store[teinte]||(store[teinte]={});
  const sub=parTeinte[kind]||(parTeinte[kind]={});
  if(sub[key]) return sub[key];
  const {c,cx}=offCanvas(base.c.width,base.c.height);
  cx.filter='hue-rotate('+hue+'deg)';
  cx.drawImage(base.c,0,0);
  cx.filter='none';
  sub[key]=Object.assign({},base,{c,cx});
  return sub[key];
}

// Étapes de génération de l'atlas, dans l'ordre. Partagées par la version
// synchrone (buildSprites, au démarrage) et la version étalée (avancerAtlas,
// au zoom) : une seule définition de « ce que contient un atlas ».
function etapesAtlas(T){
  const nbBld=Object.keys(BDEF).length, moitie=nbBld>>1;
  return [
    ()=>{ buildTerrain(T,1); },                  // herbe + sable
    ()=>{ buildTerrain(T,2); },                  // eau (4 images d'animation)
    ()=>{ buildBuildings(T,0,moitie); },
    ()=>{ buildBuildings(T,moitie,nbBld); upgradeBuildingSprites(); upgradeCivBuildingSprites(); },
    ()=>{ buildUnits(T); upgradeUnitSprites(); },
    ()=>{ buildTrees(T); buildStoneNode(T); buildGoldNode(T); buildBerry(T);
          buildFish(T); buildMeat(T);
          upgradeResourceNodes(); },   // surcouche illustrée des gisements, si dispo
    ()=>{ buildRelic(T); buildCaravan(T); upgradeSingletonSprites();
          buildWildlife(T); upgradeWildlifeSprites(); },
    ()=>{ buildShadow(); buildGlow(); buildMacro();
          buildIcons();        // icônes UI (taille fixe, générées une seule fois)
          applyStaticIcons();  // injecte les icônes dans le DOM persistant
          upgradeResourceIcons(); },
  ];
}

// ── RÉGÉNÉRATION ÉTALÉE DE L'ATLAS ──────────────────────────
// Une régénération complète coûte ~20 ms au zoom minimum mais jusqu'à ~170 ms
// au zoom maximum (les sprites y sont trois fois plus larges, donc neuf fois
// plus de pixels à peindre). Tenir tout ça dans une seule image se voyait
// comme un à-coup juste après le geste de zoom — le dernier qui restait.
//
// Le travail est donc découpé en étapes jouées une par image, dans un atlas
// BROUILLON. Pendant ce temps le rendu continue de lire l'atlas courant, à
// l'ancienne échelle (le facteur k=TILE/SPR.refT s'en charge déjà). Le
// brouillon ne prend la place de l'atlas courant qu'une fois COMPLET, par un
// échange de référence : aucune image ne peut tomber sur un atlas à moitié
// reconstruit, moitié ancienne échelle et moitié nouvelle.
let _atlasBrouillon=null, _atlasEtapes=null, _atlasRefT=0, _atlasDerniereImage=-1;

function demarrerAtlas(refT){
  if(_atlasRefT===refT) return;      // déjà en cours pour cette échelle
  _atlasRefT=refT;
  // Les icônes d'interface ont une taille fixe et ne sont générées qu'une
  // fois : on les reprend telles quelles pour que buildIcons sorte tout de
  // suite et que le HUD ne clignote pas pendant la reconstruction.
  _atlasBrouillon={ terrain:{}, tree:[], stone:[], gold:[], berry:[], bld:{}, unit:{},
                    ico:SPR.ico, iconsBuilt:SPR.iconsBuilt,
                    resIconsUpgrading:SPR.resIconsUpgrading };
  _atlasEtapes=etapesAtlas(refT*SS);
}

function avancerAtlas(){
  if(!_atlasEtapes) return;
  const courant=SPR;
  SPR=_atlasBrouillon;               // les générateurs écrivent dans le brouillon
  try{ _atlasEtapes.shift()(); }
  catch(e){ _atlasEtapes=null; _atlasBrouillon=null; _atlasRefT=0; }
  finally{ SPR=courant; }            // le rendu retrouve immédiatement l'atlas en service
  if(_atlasEtapes&&!_atlasEtapes.length){
    _atlasBrouillon.refT=_atlasRefT;
    _atlasBrouillon.teintes=null;    // les variantes teintées dérivent des sprites
    SPR=_atlasBrouillon;             // bascule atomique
    _atlasBrouillon=null; _atlasEtapes=null; _atlasRefT=0;
  }
}

// Version synchrone, pour les moments où l'on a besoin d'un atlas complet
// AVANT la première image : début de partie, chargement d'une sauvegarde.
function buildSprites(refT){
  refT=refT||sprRungFor(TILE);
  _atlasEtapes=null; _atlasBrouillon=null; _atlasRefT=0; // annule une reconstruction étalée en cours
  SPR.refT=refT;   // échelle de référence des sprites (barreau, pas TILE exact)
  SPR.teintes=null; // les variantes teintées dérivent des sprites : à refaire
  for(const etape of etapesAtlas(refT*SS)) etape();
}


// ── OMBRE PORTÉE (sprite unique, étiré à la demande) ──────────────────
// Tout ce qui se dresse sur le sol — arbre, rocher, bâtiment, unité — se
// détachait jusqu'ici sur l'herbe sans rien qui l'y rattache : la scène
// donnait l'impression d'autocollants posés sur un fond. Une tache douce
// sous chaque objet suffit à lui donner du poids, et la faire du MÊME côté
// pour tout le monde (décalée en bas-à-droite, cohérente avec le biseau
// clair-en-haut-à-gauche des bâtiments) donne au décor une lumière unique.
//
// Un seul dégradé radial pré-rendu, réétiré à chaque appel : autrement il
// faudrait recréer un createRadialGradient par objet et par image, ce qui
// coûte bien plus cher qu'un drawImage.
// Halo chaud de torche, pré-rendu comme l'ombre et pour la même raison :
// il est désormais dessiné sous CHAQUE bâtiment habité (et non plus sous
// quatre types seulement), ce qui interdit de recréer un dégradé par
// bâtiment et par image.
// ── VARIATION DE GRANDE ÉCHELLE DU SOL ────────────────────────────────
// Une fois le fond d'herbe rendu quasi uniforme (indispensable pour tuer le
// damier), une grande plaine devient plate : partout exactement le même vert.
// Ce calque corrige le problème par l'autre bout — de larges taches douces,
// bien PLUS GRANDES que la case (une douzaine de cases de côté), plaquées en
// coordonnées MONDE. L'œil y lit des reliefs et des variations de sol, sans
// qu'aucune limite ne coïncide jamais avec une frontière de tuile.
//
// Une seule texture répétée en motif : un unique fillRect par image, quel que
// soit le nombre de cases à l'écran.
function buildMacro(){
  const P=Math.max(128,Math.round(TILE*12));
  const{c,cx}=offCanvas(P,P); const rnd=srnd(4242);
  for(let i=0;i<26;i++){
    const bx=rnd()*P, by=rnd()*P, r=P*(0.10+rnd()*0.17);
    const sombre=rnd()<0.5;
    // Chaque tache est peinte neuf fois (les huit décalages ±P plus la
    // position d'origine) : celles qui débordent d'un bord réapparaissent sur
    // le bord opposé, donc la texture se répète sans couture visible.
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      const g=cx.createRadialGradient(bx+ox*P,by+oy*P,0,bx+ox*P,by+oy*P,r);
      g.addColorStop(0,sombre?'rgba(26,46,18,.23)':'rgba(170,206,124,.18)');
      g.addColorStop(1,'rgba(0,0,0,0)');
      cx.fillStyle=g;
      cx.fillRect(bx+ox*P-r,by+oy*P-r,r*2,r*2);
    }
  }
  SPR.macro={c,cx,P};
  SPR.macroPat=ctx.createPattern(c,'repeat');
}
function buildGlow(){
  const R=64, {c,cx}=offCanvas(R*2,R*2);
  const g=cx.createRadialGradient(R,R,0,R,R,R);
  g.addColorStop(0,'rgba(255,186,92,.88)');
  g.addColorStop(0.42,'rgba(255,158,64,.34)');
  g.addColorStop(1,'rgba(255,150,60,0)');
  cx.fillStyle=g; cx.fillRect(0,0,R*2,R*2);
  SPR.glow={c,cx};
}
function buildShadow(){
  const R=64, {c,cx}=offCanvas(R*2,R*2);
  const g=cx.createRadialGradient(R,R,0,R,R,R);
  g.addColorStop(0,'rgba(0,0,0,.55)');
  g.addColorStop(0.45,'rgba(0,0,0,.34)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  cx.fillStyle=g; cx.fillRect(0,0,R*2,R*2);
  SPR.shadow={c,cx};
}
// rx/ry = demi-largeur / demi-hauteur au sol ; a = opacité globale.
function groundShadow(sx,sy,rx,ry,a){
  if(!SPR.shadow) return;
  ctx.globalAlpha=a;
  ctx.drawImage(SPR.shadow.c,sx-rx,sy-ry,rx*2,ry*2);
  ctx.globalAlpha=1;
}
