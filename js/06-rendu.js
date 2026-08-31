'use strict';
// ======================================================================
//  06-rendu.js
// ======================================================================
// Rendu : sol par paves, entites, effets, mini-carte.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── RENDU ─────────────────────────────────────────────────
function render(){
  // Fenêtre dégénérée (onglet en arrière-plan, panneau du bas plus haut que
  // la fenêtre, clavier virtuel qui remonte tout) : gameH() devient négatif,
  // et le premier createRadialGradient de drawVignette lève une exception qui
  // tue la boucle de rendu pour de bon. Une image sautée ne coûte rien ; une
  // boucle morte oblige à recharger la page en pleine partie.
  if(W<=0||gameH()<=0) return;
  _frameId++;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.imageSmoothingEnabled=true; // sprites 3× réduits => rendu fin et lisse
  ctx.clearRect(0,0,W,H);

  const gh=gameH();
  ctx.save();
  ctx.beginPath(); ctx.rect(0,54,W,gh); ctx.clip();
  if(G.shake.mag>0.05){ // secousse de caméra : petits impacts nerveux, pas un tremblement de terre
    ctx.translate((Math.random()-0.5)*G.shake.mag,(Math.random()-0.5)*G.shake.mag);
  }

  drawMap(); drawNodes(); drawRelics(); drawWildlife(); drawBuildings(); drawCaravans(); drawDeathFx(); drawHeroAuras(); drawUnits();
  drawHoverRing();
  drawProjs(); drawParts(); drawFTexts(); drawSelRings();
  if(G.mode==='build'&&G.ghost) drawGhost();
  drawFog();
  drawNightTint();
  drawNightGlow();
  drawVignette();
  if(G.selBox) drawSelBox();

  ctx.restore();
  drawMinimap();
}

// Teinte nuit (overlay bleuté la nuit)
let _vigGrad=null,_vigKey='';
function drawVignette(){
  const gh=gameH(), key=W+'x'+gh;
  if(_vigKey!==key||!_vigGrad){
    const g=ctx.createRadialGradient(W/2,54+gh/2,Math.min(W,gh)*0.38,W/2,54+gh/2,Math.max(W,gh)*0.72);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,0.30)');
    _vigGrad=g; _vigKey=key;
  }
  ctx.fillStyle=_vigGrad; ctx.fillRect(0,54,W,gh);
}

function drawNightTint(){
  // 0.28 d'un bleu déjà pâle ne se voyait tout simplement pas : le cycle
  // jour/nuit — qui RÉDUIT pourtant le champ de vision, donc change la façon
  // de jouer — passait complètement inaperçu à l'écran. Voile plus dense et
  // plus froid, dosé pour rester très en deçà du brouillard de guerre : on
  // doit continuer à lire ses unités et ses bâtiments sans effort.
  const night=nightFactor()*0.44;
  if(night>0.01){
    ctx.fillStyle=`rgba(12,20,56,${night})`;
    ctx.fillRect(0,54,W,gameH());
  }
}

// Lueur chaude de torches sur les bâtiments-clés du joueur la nuit — casse
// la platitude du voile bleu uniforme et fait vivre la carte après le
// coucher du soleil, sans toucher au pixel art des sprites eux-mêmes.
// Ce qui NE s'éclaire pas la nuit : rien n'habite un mur, un portail, un
// champ ni un avant-poste. Tout le reste — maisons comprises, ce qui donne
// enfin à une ville de vingt bâtiments l'allure d'une ville éclairée — porte
// un feu. La liste est en négatif pour qu'un futur bâtiment soit allumé par
// défaut plutôt qu'oublié dans le noir.
const NO_GLOW=[BT.WALL,BT.GATE,BT.FARM,BT.OUTPOST];
function drawNightGlow(){
  const night=nightFactor();
  if(night<0.12||!SPR.glow) return;
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  for(const b of G.buildings){
    if(b.constructing||NO_GLOW.includes(b.type)) continue;
    // Les feux ennemis se voient aussi — mais seulement là où l'on VOIT :
    // hors du champ de vision, un halo trahirait une base dans le brouillard.
    if(!estLocal(b)&&G.fog.length){
      const fx=(b.tx|0), fy=(b.ty|0);
      if(G.fog[fy]&&G.fog[fy][fx]!==2) continue;
    }
    const{x:sx,y:sy}=ws(b.x,b.y);
    if(sx<-120||sx>W+120||sy<0||sy>H+120) continue;
    // Vacillement propre à chaque bâtiment (déphasé par son id) : un village
    // dont toutes les fenêtres pulsent à l'unisson ne ressemble à rien.
    const amp=0.82+Math.sin(G.gameTime*2.6+b.id*1.7)*0.18;
    const r=TILE*(0.85+0.42*(b.w+b.h));
    ctx.globalAlpha=Math.min(1,0.42*night*amp);
    ctx.drawImage(SPR.glow.c,sx-r,sy-r*0.85,r*2,r*1.7);
  }
  ctx.restore();
}

// Brouillard de guerre — bords DOUX.
// La version d'origine peignait un carré noir opaque par case : la limite du
// champ de vision se lisait comme un escalier de gros pixels, de loin le
// défaut le plus voyant du rendu. Ici on compose le voile dans un canevas
// minuscule (un pixel par case), qu'on étire ensuite à l'échelle de l'écran
// avec le lissage du navigateur : l'interpolation bilinéaire transforme
// gratuitement l'escalier en dégradé continu, façon AoE2. C'est aussi plus
// rapide que l'ancienne boucle de fillRect (un seul drawImage).
let _fogBuf=null,_fogImg=null;
function drawFog(){
  if(!G.fog.length) return;
  const cx=G.cam.x, cy=G.cam.y;
  // Une case de marge de chaque côté : sans elle, le lissage échantillonne
  // au-delà du buffer sur les bords de l'écran et y laisse une frange claire.
  const sx=Math.max(0,(cx/TILE|0)-1), sy=Math.max(0,((cy/TILE)|0)-1);
  const ex=Math.min(COLS-1,((cx+W)/TILE|0)+1), ey=Math.min(ROWS-1,((cy+gameH())/TILE|0)+1);
  const w=ex-sx+1, h=ey-sy+1;
  if(w<1||h<1) return;
  if(!_fogBuf||_fogBuf.c.width<w||_fogBuf.c.height<h) _fogBuf=offCanvas(Math.max(w,96),Math.max(h,96));
  // Tampon de pixels réutilisé tant que la fenêtre visible garde la même
  // taille en cases : sinon on rallouerait un ImageData à chaque image, pour
  // rien, soixante fois par seconde.
  if(!_fogImg||_fogImg.width!==w||_fogImg.height!==h) _fogImg=_fogBuf.cx.createImageData(w,h);
  const img=_fogImg, d=img.data;
  for(let y=0;y<h;y++){
    const row=G.fog[sy+y];
    for(let x=0;x<w;x++){
      // 0 = jamais exploré (noir opaque, on ne doit rien deviner dessous)
      // 1 = exploré mais hors de vue (voile translucide sur le souvenir)
      // 2 = visible (rien)
      const f=row[sx+x];
      d[(y*w+x)*4+3]= f===2?0 : f===0?255 : 92;
    }
  }
  _fogBuf.cx.putImageData(img,0,0);
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(_fogBuf.c, 0,0,w,h, sx*TILE-cx, sy*TILE-cy+54, w*TILE, h*TILE);
  ctx.restore();
}

function drawSelBox(){
  const b=G.selBox;
  ctx.strokeStyle='rgba(241,196,15,.9)'; ctx.lineWidth=1.5;
  ctx.fillStyle='rgba(241,196,15,.12)';
  const x=Math.min(b.x0,b.x1), y=Math.min(b.y0,b.y1);
  const w=Math.abs(b.x1-b.x0), h=Math.abs(b.y1-b.y0);
  ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
}

// Monde -> écran. Les coordonnées monde sont en unités BASE_TILE (fixes,
// indépendantes du zoom) ; c'est ICI, et seulement ici, qu'on applique
// l'échelle de zoom. G.cam reste exprimée en pixels écran zoomés (tout le
// code de pan/pincement travaille dans cet espace), d'où des bornes de
// caméra inchangées : COLS*BASE_TILE*échelle === COLS*TILE.
function ws(wx,wy){ const S=TILE/BASE_TILE; return {x:wx*S-G.cam.x, y:wy*S-G.cam.y+54}; }
// Écran -> monde, réciproque exacte de ws().
function sw(sx,sy){ const S=TILE/BASE_TILE; return {x:(sx+G.cam.x)/S, y:(sy-54+G.cam.y)/S}; }

// ── POURQUOI TOUT LE SOL RAISONNE EN PIXELS ÉCRAN ─────────
//
// Le contexte est mis à l'échelle par DPR : une position CSS entière tombe sur
// un pixel écran FRACTIONNAIRE dès que DPR n'est pas entier (1,25 sur un écran
// Windows à 125 %). Tout ce qui est peint là par `drawImage` avec une taille
// imposée est rééchantillonné à cheval sur deux pixels, et son bord — qui n'a
// rien à fondre au-delà — se mélange avec du transparent : la jointure devient
// translucide et le fond de page transparaît dessous, en fines lignes sombres.
// Le sol en a porté trois d'affilée, chacune trouvée en mesurant l'alpha :
// entre pavés (215 au lieu de 255), entre cases d'eau (205), et le long des
// rives (151).
//
// La règle qui les supprime toutes : le sol dérive ses positions d'une CAMÉRA
// QUANTIFIÉE AU PIXEL ÉCRAN (camDevX/camDevY dans drawMap), et on aligne les
// BORNES d'une case, jamais sa largeur — on prend le bord gauche puis le bord
// droit, et la différence. Aligner la position seule en gardant TILE comme
// largeur laisserait le bord droit fractionnaire, donc la couture intacte un
// bord sur deux. Pavés, eau animée et rendu de repli dérivent ainsi de la même
// expression et coïncident au pixel.
//
// Corollaire : ne jamais laisser une couche statique faire un TROU en comptant
// sur une couche mobile pour le combler — c'était l'origine de la couture des
// rives (voir EAU_FOND dans terrainChunk).

// ── CACHE DE TERRAIN PAR PAVÉS ────────────────────────────
// Le sol est STATIQUE : ni la variante d'herbe, ni son miroir, ni le
// liséré de rive ne changent d'une image à l'autre. Le redessiner case par
// case coûtait pourtant ~6 ms par image au zoom minimum (plus de 6 000
// drawImage, plus jusqu'à douze tests de voisinage par case pour la rive).
// On le pré-rend donc par pavés de 8×8 cases, réutilisés tant que l'échelle
// ne change pas ; seule l'eau, animée, reste peinte à chaque image
// par-dessus.
const TCHUNK=8;
// Plafond mémoire du cache, mesuré en pixels ÉCRAN (×4 octets → ~30 Mo). Les
// pavés étant peints à la résolution de l'écran, ce plafond borne bien des
// octets et non un nombre de pavés : à DPR élevé chaque pavé pèse plus lourd,
// donc il en tient moins en cache — ce qui est le comportement voulu.
// L'ensemble réellement visible ne dépasse jamais ~45 pavés au zoom minimum ni
// ~12 au zoom maximum ; mesuré à DPR 1,25, cela fait 3,0 Mpx au zoom minimum et
// 4,5 Mpx au maximum, soit une marge qui tient encore à DPR 2. Le plafond borne
// ce qu'un long panoramique (ou des clics répétés sur la mini-carte, qui
// téléportent la vue) peut accumuler sur un téléphone.
const TCHUNK_PIXELS=8e6;
// Pavés générés au plus par image. Un panoramique normal n'en réclame que 0,2
// par image ; ce budget ne sert qu'aux rafales — changement de zoom (qui les
// invalide tous d'un coup) ou saut de caméra depuis la mini-carte. À dix, la
// rafale coûtait 20 à 30 ms sur l'image suivant le zoom ; à cinq elle tient
// dans une dizaine de millisecondes, le reste de l'écran étant peint pour
// cette image par le rendu direct (voir `manquants`), exactement comme avant
// l'existence du cache.
const TCHUNK_BUDGET=5;
let _tchunks=new Map(), _tchunkT=-1, _tchunkBudget=0, _frameId=0;
function invalidateTerrainChunks(){ _tchunks.clear(); _tchunkT=TILE; }

// Variante ET orientation stables par tuile (8 textures × 4 miroirs = 32
// aspects distincts). Le miroir est tiré d'un second brassage du même hash,
// pour qu'il ne soit pas corrélé à la variante : sinon la variante 3 serait
// toujours retournée de la même façon et on retomberait sur 8 aspects.
function grassSprite(x,y){
  let h=(x*374761393+y*668265263)|0; h=(h^(h>>13))*1274126177|0;
  h=(h^(h>>16))|0;
  const v=((h%GRASS_VARIANTS)+GRASS_VARIANTS)%GRASS_VARIANTS;
  const m=(((h>>5)%4)+4)%4;
  return SPR.terrain[m?('grass'+v+'m'+m):('grass'+v)];
}

// ── CLAIRIÈRES DE TERRE ───────────────────────────────────
// Le sol n'était qu'un tapis d'herbe uniforme : la variété tenait entièrement
// aux 32 aspects de tuile, tous de la MÊME couleur, plus un voile de macro-
// variation. À l'échelle d'une plaine, ça reste plat — rien n'a la taille
// d'un accident de terrain.
//
// Ces clairières travaillent à l'échelle intermédiaire, celle qui manquait :
// des plaques de terre battue de deux à six cases de large, aux contours
// organiques (quatre ellipses dégradées qui se chevauchent, jamais un
// cercle), semées une au plus par pavé de 8×8.
//
// Trois propriétés, toutes nécessaires :
//  • DÉTERMINISTES par position de pavé (hachage de ccx/ccy, pas de RND) :
//    la même clairière est peinte à l'identique par l'hôte et par le client,
//    et elle ne bouge pas quand le pavé est purgé du cache puis regénéré.
//  • PEINTES DANS LE PAVÉ, donc une fois pour toutes : coût nul par image,
//    exactement comme l'herbe et la rive (voir terrainChunk).
//  • DÉBORDANTES : on parcourt les neuf pavés voisins, pas seulement le
//    sien. Une clairière posée près d'un bord se prolonge donc dans le pavé
//    d'à côté au lieu d'être tranchée net à la couture.
// Les plaques qui mordent sur l'eau ne posent pas de problème : l'eau,
// animée, est repeinte par-dessus le pavé à chaque image (voir drawMap).
function drawPatches(g,ccx,ccy,ox,oy){
  const sol=solCfg();
  if(!sol.densite) return;
  // Le canvas cible est en pixels ÉCRAN (pavé de terrain) ou est le canvas
  // principal, lui aussi en pixels écran : dans les deux cas on raisonne ici
  // en unités CSS, comme le transform du contexte.
  const wmax=g.canvas.width/DPR, hmax=g.canvas.height/DPR;
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    const px2=ccx+dx, py2=ccy+dy;
    if(px2<0||py2<0) continue;
    // Générateur local au pavé : quelques tirages seulement, mais il doit
    // être décorrélé de celui de l'herbe (qui hache la CASE) pour qu'une
    // clairière ne tombe pas systématiquement sur la même variante.
    let h=(px2*2654435761+py2*1597334677+911)|0;
    h=(h^(h>>>13))*1274126177|0; h=(h^(h>>>16))|0;
    const rnd=()=>{ h=(h*1664525+1013904223)|0; return ((h>>>8)&0xffffff)/0x1000000; };
    if(rnd()>=sol.densite) continue;
    const cxp=(px2*TCHUNK+rnd()*TCHUNK)*TILE-ox;
    const cyp=(py2*TCHUNK+rnd()*TCHUNK)*TILE-oy;
    const R=TILE*(1.1+rnd()*2.0);
    // Rejet rapide : une clairière d'un pavé voisin qui ne mord pas sur
    // celui-ci ne coûte que le hachage ci-dessus.
    if(cxp<-R||cyp<-R||cxp>wmax+R||cyp>hmax+R) continue;
    for(let k=0;k<4;k++){
      const bx=cxp+(rnd()-0.5)*R*0.95, by=cyp+(rnd()-0.5)*R*0.95;
      const br=R*(0.42+rnd()*0.52);
      const gr=g.createRadialGradient(bx,by,0,bx,by,br);
      // Cœur franc, bord fondu : c'est le fondu qui empêche la plaque de se
      // lire comme un disque posé sur l'herbe.
      gr.addColorStop(0,'rgba('+sol.terre+',.42)');
      gr.addColorStop(0.55,'rgba('+sol.terre+',.22)');
      gr.addColorStop(1,'rgba('+sol.terre+',0)');
      g.fillStyle=gr;
      g.fillRect(bx-br,by-br,br*2,br*2);
    }
  }
}

function terrainChunk(ccx,ccy){
  const key=ccy*4096+ccx;
  const hit=_tchunks.get(key);
  if(hit){ hit.used=_frameId; return hit; }
  if(_tchunkBudget<=0) return null;   // budget épuisé : rendu direct cette image
  _tchunkBudget--;
  const x0=ccx*TCHUNK, y0=ccy*TCHUNK;
  // Origine et taille en PIXELS ÉCRAN. Le pavé était stocké en pixels CSS puis
  // agrandi par le transform DPR à l'affichage : sur un écran à 125 % il ne
  // portait que 80 % des pixels qu'il couvrait (50 % sur un écran 2×), et tout
  // le détail du sol passait par un agrandissement. Les textures étant
  // supersamplées ×3 (114 px de source pour une case de 38), il y avait bien du
  // détail à récupérer : le pavé est désormais peint à la résolution réelle de
  // l'écran et composé 1:1, sans agrandissement.
  const oxDev=Math.round(x0*TILE*DPR), oyDev=Math.round(y0*TILE*DPR);
  const ox=oxDev/DPR, oy=oyDev/DPR;   // la même origine, en unités CSS
  // Bornes de case, en CSS mais toutes multiples de 1/DPR : elles retombent
  // donc exactement sur des frontières de pixel écran. C'est ce qui fait
  // coïncider AU PIXEL la grille interne du pavé et celle de l'eau animée
  // (voir BX/BY dans drawMap) — les deux dérivent de la même expression.
  const bX=x=>(Math.round(x*TILE*DPR)-oxDev)/DPR;
  const bY=y=>(Math.round(y*TILE*DPR)-oyDev)/DPR;
  // Le pavé fait EXACTEMENT la largeur de ses huit cases, sans marge. Il en
  // portait deux pixels, parce que la dernière case était peinte sur TILE
  // pixels flottants depuis une position arrondie et pouvait déborder d'une
  // fraction de pixel. Cette marge restait quasi transparente (alpha ~26), et
  // le pavé étant rééchantillonné à l'affichage, le filtrage bilinéaire de sa
  // dernière colonne OPAQUE allait chercher la marge voisine — donc du
  // transparent — et rendait la jointure translucide.
  //
  // On supprime la cause plutôt que de la masquer : les cases pavent le
  // canvas exactement (largeurs arrondies ci-dessous), plus rien ne déborde,
  // donc plus de marge à prévoir et un pavé opaque d'un bord à l'autre.
  // À lire avec l'alignement écran de drawMap : les deux sont nécessaires,
  // les mesures sont là-bas.
  const wDev=Math.round((x0+TCHUNK)*TILE*DPR)-oxDev, hDev=Math.round((y0+TCHUNK)*TILE*DPR)-oyDev;
  const{c,cx:g}=offCanvas(wDev,hDev);
  // Le canvas est en pixels écran, mais tout ce qui peint dedans (cases, rive,
  // clairières) continue de raisonner en unités CSS : le transform s'en charge.
  g.setTransform(DPR,0,0,DPR,0,0);
  g.imageSmoothingEnabled=true;
  const ex=Math.min(COLS-1,x0+TCHUNK-1), ey=Math.min(ROWS-1,y0+TCHUNK-1);
  // Passes séparées, et dans cet ordre : les clairières doivent passer SOUS
  // l'écume de rive, pas dessus.
  //
  // Il y avait ici une troisième passe, un voile de couleur par biome plaqué
  // case par case au-dessus de l'herbe. Elle a disparu : la couleur de la
  // carte est maintenant PEINTE DANS la texture (voir SOLS et buildTerrain),
  // ce qui la rend franche sans effacer le grain — et supprime au passage un
  // fillRect translucide par case et par pavé.
  for(let y=y0;y<=ey;y++) for(let x=x0;x<=ex;x++){
    if(G.tiles[y][x]===T_WATER) continue;   // l'eau est animée : hors cache
    const px2=bX(x), py2=bY(y);
    // Largeur d'un bord au bord suivant, et non TILE pixels flottants : les
    // cases pavent alors le canvas exactement, sans se chevaucher ni laisser
    // de jour, et la dernière ne déborde pas.
    const dw=bX(x+1)-px2, dh=bY(y+1)-py2;
    const sp=grassSprite(x,y);
    if(sp) g.drawImage(sp.c,px2,py2,dw,dh);
  }
  drawPatches(g,ccx,ccy,ox,oy);
  // FOND D'EAU OPAQUE sous les cases d'eau. Le pavé les laissait en trou, à
  // charge pour l'eau animée de les combler à chaque image — mais les deux ne
  // sont pas posées sur la même grille : le pavé est aligné EN BLOC, donc ses
  // cases tombent à « origine alignée + un entier de pixels CSS », tandis que
  // l'eau animée est alignée case par case sur le pixel écran. Les deux grilles
  // divergent d'un demi-pixel écran, et l'écart s'ouvrait exactement le long de
  // chaque RIVE : une colonne à alpha 151 sur toute la hauteur du lac, le fond
  // de page visible au travers.
  //
  // Plutôt que de faire coïncider les deux grilles au pixel près — fragile, et
  // à refaire à chaque fois qu'une surface s'ajoute —, on supprime le trou :
  // sous l'eau animée il y a désormais la couleur de fond de l'eau (la même que
  // la base du sprite, voir buildTerrainEau). Le décalage d'un demi-pixel
  // subsiste, mais il ne découvre plus que de l'eau unie au lieu du vide.
  for(let y=y0;y<=ey;y++) for(let x=x0;x<=ex;x++){
    if(G.tiles[y][x]!==T_WATER) continue;
    const px2=bX(x), py2=bY(y);
    g.fillStyle=EAU_FOND;
    g.fillRect(px2,py2,bX(x+1)-px2,bY(y+1)-py2);
  }
  for(let y=y0;y<=ey;y++) for(let x=x0;x<=ex;x++){
    if(G.tiles[y][x]===T_WATER) continue;
    drawShore(g,x,y,bX(x),bY(y),bX(x+1)-bX(x),bY(y+1)-bY(y));
  }
  const ch={c,oxDev,oyDev,used:_frameId};
  _tchunks.set(key,ch);
  return ch;
}

function drawMap(){
  const cx=G.cam.x, cy=G.cam.y;
  const sx=Math.max(0,cx/TILE|0), sy=Math.max(0,(cy/TILE)|0);
  const ex=Math.min(COLS-1,(cx+W)/TILE|0), ey=Math.min(ROWS-1,(cy+gameH())/TILE|0);
  const waterFrame=(G.gameTime*3|0)%4; // animation eau ~3fps
  if(_tchunkT!==TILE) invalidateTerrainChunks();
  _tchunkBudget=TCHUNK_BUDGET;

  // 1) sol statique, par pavés pré-rendus
  const c0=(sx/TCHUNK)|0, c1=(ex/TCHUNK)|0, r0=(sy/TCHUNK)|0, r1=(ey/TCHUNK)|0;
  let manquants=null;
  // Caméra quantifiée au PIXEL ÉCRAN. Tout le sol — pavés, eau, repli — en
  // dérive, ce qui met ces trois surfaces sur une seule et même grille, celle
  // de l'écran. C'est ce qui supprime les coutures : elles venaient toutes de
  // deux grilles voisines qui divergeaient d'une fraction de pixel.
  // Le décalage de 54 px (barre du haut) est absorbé ICI, dans camDevY : le
  // laisser hors du calcul le ferait retomber sur 67,5 pixels écran et
  // désalignerait tout d'un demi-pixel.
  const camDevX=Math.round(cx*DPR), camDevY=Math.round((cy-54)*DPR);
  // Le pavé est en pixels écran : on le compose 1:1, taille explicite en CSS.
  for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++){
    const ch=terrainChunk(c,r);
    if(ch) ctx.drawImage(ch.c,(ch.oxDev-camDevX)/DPR,(ch.oyDev-camDevY)/DPR,
                              ch.c.width/DPR,ch.c.height/DPR);
    else (manquants||(manquants=[])).push(c,r);
  }
  // Bornes de case alignées sur le pixel écran, pré-calculées une fois pour
  // toute la fenêtre visible : le repli ci-dessous et l'eau animée peignent
  // case par case dans le canvas principal (contrairement à l'herbe, cuite
  // dans le pavé), et sont donc exposés exactement à la même couture.
  // BX[i] est le bord GAUCHE de la case sx+i, BX[i+1] son bord droit — d'où
  // la borne supplémentaire.
  const BX=new Float64Array(ex-sx+2), BY=new Float64Array(ey-sy+2);
  for(let i=0;i<BX.length;i++) BX[i]=(Math.round((sx+i)*TILE*DPR)-camDevX)/DPR;
  for(let i=0;i<BY.length;i++) BY[i]=(Math.round((sy+i)*TILE*DPR)-camDevY)/DPR;

  // Pavés pas encore générés (budget épuisé) : rendu direct pour cette image
  // seulement — ils rejoindront le cache aux images suivantes.
  if(manquants){
    for(let i=0;i<manquants.length;i+=2){
      const bx=manquants[i]*TCHUNK, by=manquants[i+1]*TCHUNK;
      const mex=Math.min(ex,bx+TCHUNK-1), mey=Math.min(ey,by+TCHUNK-1);
      for(let y=Math.max(sy,by);y<=mey;y++) for(let x=Math.max(sx,bx);x<=mex;x++){
        if(G.tiles[y][x]===T_WATER) continue;
        const px2=BX[x-sx], py2=BY[y-sy];
        const dw=BX[x-sx+1]-px2, dh=BY[y-sy+1]-py2;
        const sp=grassSprite(x,y);
        if(sp) ctx.drawImage(sp.c,px2,py2,dw,dh);
      }
      // Clairières du pavé manquant, écrêtées à SON rectangle : sans ce
      // découpage, une plaque débordante viendrait se poser une seconde fois
      // sur le pavé voisin, lui déjà peint depuis le cache avec la sienne.
      ctx.save();
      ctx.beginPath();
      const rx=(Math.round(bx*TILE*DPR)-camDevX)/DPR, ry=(Math.round(by*TILE*DPR)-camDevY)/DPR;
      ctx.rect(rx,ry,(Math.round((bx+TCHUNK)*TILE*DPR)-camDevX)/DPR-rx,
                     (Math.round((by+TCHUNK)*TILE*DPR)-camDevY)/DPR-ry);
      ctx.clip();
      drawPatches(ctx,manquants[i],manquants[i+1],camDevX/DPR,camDevY/DPR);
      ctx.restore();
      for(let y=Math.max(sy,by);y<=mey;y++) for(let x=Math.max(sx,bx);x<=mex;x++){
        if(G.tiles[y][x]===T_WATER) continue;
        drawShore(ctx,x,y,BX[x-sx],BY[y-sy],BX[x-sx+1]-BX[x-sx],BY[y-sy+1]-BY[y-sy]);
      }
    }
  }

  // 2) eau animée, peinte à chaque image par-dessus les pavés.
  //
  // Bornes BX/BY, issues de la même caméra quantifiée que le pavé : le lac est
  // le pire cas de la couture décrite en tête de fichier, car le pavé n'y pose
  // qu'un fond uni sous une eau animée qui, elle, bouge. Mesuré au cœur d'un
  // lac avant correction : colonnes à alpha 205 toutes les deux cases, lignes à
  // alpha 218 à chaque case. (Une jointure sur deux seulement en colonnes :
  // avec TILE=38 et DPR=1,25, un bord de case sur deux tombait déjà par chance
  // sur un pixel écran entier — de quoi rendre le motif trompeur à l'œil.)
  for(let y=sy;y<=ey;y++) for(let x=sx;x<=ex;x++){
    if(G.tiles[y][x]!==T_WATER) continue;
    const px2=BX[x-sx], py2=BY[y-sy];
    const dw=BX[x-sx+1]-px2, dh=BY[y-sy+1]-py2;
    // variante stable par tuile (même principe que l'herbe) : sans elle,
    // toutes les cases d'un lac porteraient les crêtes aux mêmes hauteurs
    // et se rejoindraient en longues bandes rectilignes.
    let hw=(x*2246822519+y*3266489917)|0; hw=(hw^(hw>>15))*668265263|0; hw=(hw^(hw>>13))|0;
    const vw=((hw%WATER_VARIANTS)+WATER_VARIANTS)%WATER_VARIANTS;
    const sp=SPR.terrain['water'+vw+'_'+waterFrame];
    if(sp) ctx.drawImage(sp.c,px2,py2,dw,dh);
  }

  // 3) purge des pavés hors écran quand le cache dépasse son plafond, mesuré
  // en pixels et non en nombre de pavés : un pavé au zoom maximum pèse une
  // quinzaine de fois celui du zoom minimum.
  const pxx=Math.ceil(TCHUNK*TILE*DPR);   // pavé sans marge, en pixels écran
  if(_tchunks.size*pxx*pxx>TCHUNK_PIXELS){
    for(const [k,ch] of _tchunks) if(ch.used!==_frameId) _tchunks.delete(k);
  }

  // Calques de variation lente, en coordonnées monde (voir buildMacro) : le
  // large d'abord — c'est le fond de vallée —, le fin par-dessus.
  const gh=gameH();
  const calque=(pat,P)=>{
    ctx.save();
    ctx.fillStyle=pat;
    ctx.translate(-(((cx%P)+P)%P), 54-(((cy%P)+P)%P));
    ctx.fillRect(0,0,W+P,gh+P);
    ctx.restore();
  };
  if(SPR.macroLargePat) calque(SPR.macroLargePat,SPR.macroLargeP);
  if(SPR.macroPat) calque(SPR.macroPat,SPR.macroP);
}

// Liséré de rive (transition herbe→eau façon AoE2)
//
// Deux corrections par rapport à la version d'origine, toutes deux visibles
// sur une berge droite :
//  • les coins étaient peints APRÈS les bandes, en sable seul : sur une rive
//    horizontale, les deux diagonales du bas sont de l'eau, donc chaque tuile
//    voyait son écume recouverte de sable à gauche et à droite — la ligne
//    d'écume se lisait en pointillés réguliers tout le long du lac. Ils sont
//    désormais peints d'abord, et seulement là où ils comblent une vraie
//    encoche (les deux voisins orthogonaux étant de la terre).
//  • l'épaisseur de l'écume varie légèrement d'une tuile à l'autre (hachage
//    de position, donc stable) : la rive n'est plus un trait à la règle.
//
// Le contexte est passé en paramètre : la rive est peinte une fois pour
// toutes dans le pavé de terrain (voir terrainChunk), pas dans le canvas
// principal.
// Feston de rive, continu d'une case à l'autre.
//
// Indexé sur une position MONDE en quarts de case : l'échantillon partagé par
// deux cases voisines a donc EXACTEMENT la même valeur, et l'ondulation se
// raccorde au lieu de faire une marche à chaque limite de case. Le décalage
// par côté (`cote`) évite que le bord nord et le bord sud d'une même berge
// ondulent à l'identique.
function bruitRive(i){
  let h=(i*2654435761)|0; h=(h^(h>>>13))*1274126177|0; h=(h^(h>>>16))|0;
  return ((h>>>8)&0xffff)/0xffff;
}
const RIVE_ONDUL=4;   // ondulations par case
// Profondeur de la bande à la fraction u de la case, interpolée en COSINUS
// entre les valeurs de contrôle : la pente est nulle aux nœuds, donc le
// raccord d'une case à l'autre est lisse et non anguleux.
function profondeurRive(iBase,u,b){
  const f=u*RIVE_ONDUL, j=Math.floor(f), t=f-j;
  const a=bruitRive(iBase+j), c=bruitRive(iBase+j+1);
  const m=(1-Math.cos(t*Math.PI))/2;
  return b*(0.45+0.85*(a+(c-a)*m));
}

// ── LISÉRÉ DE RIVE ────────────────────────────────────────
// La rive était faite de rectangles en APLAT : deux bords parfaitement
// droits et parallèles, à largeur constante, le tout dans une couleur unie —
// ça se lisait comme un margelle de piscine, et c'était le dessin le plus
// faible du jeu au zoom maximum. Pire : `SPR.terrain.sand`, une vraie texture
// de sable (dégradé, grain, galets, bois flotté) était générée à CHAQUE
// reconstruction d'atlas et n'était lue nulle part.
//
// Ici :
//  • le sable est la TEXTURE, détourée par la forme de la bande (clip) —
//    la planche générée sert enfin à quelque chose ;
//  • le bord côté terre ONDULE, avec un feston continu d'une case à l'autre
//    (voir bruitRive) : la largeur n'est plus constante, la berge n'est plus
//    un ruban ;
//  • l'écume reste au contact de l'eau, qui est droite — c'est la limite de
//    case, et elle ne peut pas bouger sans déformer la case d'eau — mais son
//    épaisseur ondule elle aussi, sur un décalage différent de celui du sable
//    pour ne pas dessiner deux fois la même vague.
//
// Le contexte est passé en paramètre : la rive est peinte une fois pour
// toutes dans le pavé de terrain (voir terrainChunk), pas dans le canvas
// principal — tout ce travail ne coûte donc rien par image.
function drawShore(g,x,y,px2,py2,dw,dh){
  const isW=(xx,yy)=> xx>=0&&yy>=0&&xx<COLS&&yy<ROWS&&G.tiles[yy][xx]===T_WATER;
  const n=isW(x,y-1), sO=isW(x,y+1), o=isW(x-1,y), e=isW(x+1,y);
  const no=isW(x-1,y-1), ne=isW(x+1,y-1), so=isW(x-1,y+1), se=isW(x+1,y+1);
  // Sortie immédiate sur les cases d'intérieur des terres, soit l'écrasante
  // majorité : rien à peindre là où il n'y a aucune rive.
  if(!n&&!sO&&!o&&!e&&!no&&!ne&&!so&&!se) return;
  dw=dw||TILE; dh=dh||TILE;
  const b=Math.max(3,TILE*0.20);
  const X0=px2, Y0=py2, X1=px2+dw, Y1=py2+dh;
  const PAS=16;                        // segments par côté pour lisser le feston
  const DEC={n:0, s:100003, o:200003, e:300007};   // décalages de hachage par côté

  // 1) forme de la bande de sable : un seul chemin pour toute la case, pour
  //    ne détourer et ne peindre la texture qu'une fois.
  const forme=new Path2D();
  if(n){ forme.moveTo(X0,Y0); forme.lineTo(X1,Y0);
    for(let i=PAS;i>=0;i--){ const u=i/PAS;
      forme.lineTo(X0+u*dw, Y0+profondeurRive(x*RIVE_ONDUL+DEC.n,u,b)); }
    forme.closePath(); }
  if(sO){ forme.moveTo(X0,Y1); forme.lineTo(X1,Y1);
    for(let i=PAS;i>=0;i--){ const u=i/PAS;
      forme.lineTo(X0+u*dw, Y1-profondeurRive(x*RIVE_ONDUL+DEC.s,u,b)); }
    forme.closePath(); }
  if(o){ forme.moveTo(X0,Y0); forme.lineTo(X0,Y1);
    for(let i=PAS;i>=0;i--){ const u=i/PAS;
      forme.lineTo(X0+profondeurRive(y*RIVE_ONDUL+DEC.o,u,b), Y0+u*dh); }
    forme.closePath(); }
  if(e){ forme.moveTo(X1,Y0); forme.lineTo(X1,Y1);
    for(let i=PAS;i>=0;i--){ const u=i/PAS;
      forme.lineTo(X1-profondeurRive(y*RIVE_ONDUL+DEC.e,u,b), Y0+u*dh); }
    forme.closePath(); }
  // Coins. Deux cas, et il faut les DEUX :
  //  • l'encoche : la diagonale est mouillée mais les deux côtés sont secs —
  //    un peu de sable comble le creux.
  //  • le VIRAGE : deux côtés voisins sont mouillés. Leurs deux bandes se
  //    rejoignaient à angle droit en laissant un carré d'herbe pointer dans
  //    le sable, bien visible à chaque coude de berge. Le disque comble ce
  //    carré et arrondit le virage, ce que fait aussi une vraie plage.
  // Arrondis dans les deux cas : un carré de sable posé dans un angle se voit.
  const coin=(cx2,cy2)=>{ forme.moveTo(cx2+b,cy2); forme.arc(cx2,cy2,b,0,Math.PI*2); };
  if(no&&!o&&!n) coin(X0,Y0);
  if(ne&&!e&&!n) coin(X1,Y0);
  if(so&&!o&&!sO) coin(X0,Y1);
  if(se&&!e&&!sO) coin(X1,Y1);
  if(n&&o) coin(X0,Y0);
  if(n&&e) coin(X1,Y0);
  if(sO&&o) coin(X0,Y1);
  if(sO&&e) coin(X1,Y1);

  // 2) la texture de sable, détourée par cette forme
  const sable=SPR.terrain&&SPR.terrain.sand;
  g.save();
  g.clip(forme);
  if(sable) g.drawImage(sable.c,X0,Y0,dw,dh);
  else { g.fillStyle='#c9ab72'; g.fillRect(X0,Y0,dw,dh); }
  g.restore();

  // 3) écume au contact direct de l'eau. Épaisseur ondulée, sur un décalage
  //    de hachage distinct : sinon la crête d'écume suivrait exactement le
  //    feston du sable et les deux se liraient comme un seul trait.
  g.fillStyle='#f0e4b8';
  const ecume=(horizontal,fixe,vers,iBase)=>{
    const ep=u=>Math.max(1,profondeurRive(iBase,u,b)*0.42);
    g.beginPath();
    if(horizontal){
      g.moveTo(X0,fixe);
      for(let i=0;i<=PAS;i++){ const u=i/PAS; g.lineTo(X0+u*dw,fixe+vers*ep(u)); }
      g.lineTo(X1,fixe);
    } else {
      g.moveTo(fixe,Y0);
      for(let i=0;i<=PAS;i++){ const u=i/PAS; g.lineTo(fixe+vers*ep(u),Y0+u*dh); }
      g.lineTo(fixe,Y1);
    }
    g.closePath(); g.fill();
  };
  if(n)  ecume(true, Y0, 1, x*RIVE_ONDUL+DEC.n+51);
  if(sO) ecume(true, Y1,-1, x*RIVE_ONDUL+DEC.s+51);
  if(o)  ecume(false,X0, 1, y*RIVE_ONDUL+DEC.o+51);
  if(e)  ecume(false,X1,-1, y*RIVE_ONDUL+DEC.e+51);
}

function drawNodes(){
  for(const n of G.nodes){
    if(n.amt<=0) continue;
    const{x:sx,y:sy}=ws(n.x,n.y);
    if(sx<-TILE*2||sx>W+TILE*2||sy<48-TILE||sy>H+TILE*2) continue;
    let spr=null;
    if(n.type===RT.TREE)      spr=SPR.tree[n.id%SPR.tree.length];
    else if(n.type===RT.STONE)spr=SPR.stone[n.id%SPR.stone.length];
    else if(n.type===RT.GOLD) spr=SPR.gold[n.id%SPR.gold.length];
    else if(n.type===RT.FISH) spr=SPR.fish[n.id%SPR.fish.length];
    else if(n.type===RT.MEAT) spr=SPR.meat[n.id%SPR.meat.length];
    else                      spr=SPR.berry[n.id%SPR.berry.length];
    if(spr){
      // léger amincissement quand la ressource s'épuise
      const r=(0.55+0.45*(n.amt/n.max))*(TILE/(SPR.refT||TILE));
      const w=spr.S*r, h=spr.S*r;
      // Ombre au sol (sauf poissons : ils SONT dans l'eau, une tache sous
      // eux se lirait comme un trou dans le lac). Les arbres, plus hauts,
      // en projettent une plus longue et plus marquée que les buissons.
      if(n.type!==RT.FISH){
        const tall=n.type===RT.TREE;
        groundShadow(sx+w*0.12, sy+h*(tall?0.05:0.03), w*(tall?0.38:0.30), w*(tall?0.17:0.13), tall?0.65:0.5);
      }
      ctx.drawImage(spr.c, Math.round(sx-w/2), Math.round(sy-h*0.78), Math.round(w), Math.round(h));
    }
    // points de récolteurs
    if(n.gatherers.length>0){
      ctx.fillStyle='rgba(241,196,15,.85)';
      for(let i=0;i<n.gatherers.length;i++){
        ctx.fillRect((sx+Math.cos(i*2.1)*TILE*0.5)|0,(sy+Math.sin(i*2.1)*TILE*0.5)|0,2,2);
      }
    }
  }
}

// Cases occupées par un mur ou un portail, reconstruites à chaque image.
// Sert uniquement au raccord vertical des murs (voir plus bas) ; un Set
// reconstruit coûte moins qu'un balayage de G.buildings par mur.
let _murSet=new Set();
// Clé entière : la concaténation de chaînes allouait une chaîne par mur et
// par image (même raison que gridKey plus haut).
function murKey(tx,ty){ return ty*4096+tx; }
function indexerMurs(){
  _murSet.clear();
  for(const b of G.buildings) if(b.type===BT.WALL||b.type===BT.GATE) _murSet.add(murKey(b.tx,b.ty));
}

function drawBuildings(){
  indexerMurs();
  for(const b of G.buildings){
    const pw=b.w*TILE, ph=b.h*TILE;
    const{x:sx,y:sy}=ws(b.x,b.y);
    if(sx<-pw*2||sx>W+pw*2||sy<54-ph*2||sy>H+ph*2) continue;
    const bx=sx-pw/2, by=sy-ph/2;
    const teinte=(fac(b)||{}).teinte||'rouge';
    const ageB=ageOf(b.owner);
    const lvlSuffix=(b.type===BT.TOWER&&(b.level||1)>=2)?'_L'+b.level
                   :((b.type===BT.TC||b.type===BT.BARRACKS||b.type===BT.WALL)&&ageB>0)?'_A'+ageB
                   :(b.type===BT.GATE&&b.open)?'_OPEN'
                   :'';
    // Les habillages d'âge suivent l'âge du PROPRIÉTAIRE, pas celui du joueur
    // local : en 1v1 les deux camps ne progressent pas au même rythme.
    const suf=(teinte==='bleu')?'':'_E';
    // Illustration propre à la civilisation du PROPRIÉTAIRE, si ce type de
    // bâtiment et cette civilisation en ont une (voir BLD_CIV_SPRITE_FILES) ;
    // sinon repli sur le sprite générique, exactement comme avant.
    const civ=civKeyOf(b.owner);
    const civDispo=civ!=='francs'&&BLD_CIV_SPRITE_FILES[b.type]&&BLD_CIV_SPRITE_FILES[b.type][civ];
    const spr=(civDispo&&sprTeinte('bldCiv',b.type+'_'+civ+lvlSuffix+suf,teinte))
             ||sprTeinte('bld',b.type+lvlSuffix+suf,teinte)||sprTeinte('bld',b.type+suf,teinte);
    const k=TILE/(SPR.refT||TILE); // facteur si zoom en cours (sprites pas encore régénérés)
    // Ombre portée au pied du bâtiment — dessinée AVANT le sprite pour ne
    // jamais mordre dessus, et débordant un peu sur la droite (source de
    // lumière en haut à gauche, comme le biseau des murs).
    groundShadow(sx+pw*0.13, by+ph-Math.max(2,ph*0.04), pw*0.70, ph*0.30, b.constructing?0.35:0.85);
    if(spr){
      // le sprite a une marge haute (oy) pour les toits en relief
      const sy0=Math.round(by-spr.oy*k), dw=spr.dw*k, dh=spr.dh*k;
      // ── Raccord vertical des murs ──
      // Le sprite de mur est une palissade vue de face : empilé pour un tronçon
      // nord-sud, il répétait ses pointes de rondins à chaque case et le mur se
      // lisait comme une échelle. Dès qu'une case de mur en a une autre
      // AU-DESSUS, on ne dessine plus que le corps du sprite (source rognée
      // au-dessus des pointes/créneaux), étiré sur toute la hauteur de la case :
      // le tronçon devient un mur continu, et seule la case de tête garde ses
      // pointes. Un tronçon est-ouest, lui, n'a jamais de mur au-dessus et reste
      // rendu tel quel.
      const murSuite=(b.type===BT.WALL||b.type===BT.GATE)&&!b.constructing&&_murSet.has(murKey(b.tx,b.ty-1));
      if(murSuite){
        const src=spr.c, cut=src.height*0.53;   // au-dessus : pointes et créneaux
        ctx.drawImage(src, 0, cut, src.width, src.height-cut, Math.round(bx), Math.round(by), pw, ph);
      } else if(b.constructing&&b.progress<1&&b.progress>0){
        // Le bâtiment "sort de terre" au lieu d'un simple fondu d'opacité :
        // silhouette fantôme complète (aperçu de la forme finale) + partie
        // basse déjà bâtie révélée nettement, qui grandit avec b.progress.
        ctx.globalAlpha=0.16;
        ctx.drawImage(spr.c, Math.round(bx), sy0, dw, dh);
        ctx.globalAlpha=1;
        const revealH=Math.max(2,dh*b.progress);
        ctx.save();
        ctx.beginPath(); ctx.rect(bx-2, sy0+(dh-revealH), pw+4, revealH+4); ctx.clip();
        ctx.drawImage(spr.c, Math.round(bx), sy0, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(spr.c, Math.round(bx), sy0, dw, dh);
      }
    } else {
      ctx.fillStyle=(teinte==='bleu')?'#8a6a3a':couleurMinimap(b,false); ctx.fillRect(bx,by,pw,ph);
    }
    // Contour de sélection : quatre équerres d'angle plutôt qu'un rectangle
    // plein. Un cadre continu autour d'un bâtiment de 2×2 cases masque le
    // liseré du toit et se confond avec les murs ; les équerres désignent
    // sans rien recouvrir, et se lisent tout de suite comme un viseur.
    if(estSel(b.id)){
      const rx=Math.round(bx)-2, ry=Math.round(by)-2, rw=pw+4, rh=ph+4;
      const a=Math.max(5,Math.min(rw,rh)*0.28); // longueur de branche
      ctx.strokeStyle='rgba(0,0,0,.55)'; ctx.lineWidth=4; ctx.lineCap='butt';
      for(let pass=0;pass<2;pass++){
        if(pass) { ctx.strokeStyle='#f1c40f'; ctx.lineWidth=2; }
        ctx.beginPath();
        ctx.moveTo(rx,ry+a); ctx.lineTo(rx,ry); ctx.lineTo(rx+a,ry);
        ctx.moveTo(rx+rw-a,ry); ctx.lineTo(rx+rw,ry); ctx.lineTo(rx+rw,ry+a);
        ctx.moveTo(rx+rw,ry+rh-a); ctx.lineTo(rx+rw,ry+rh); ctx.lineTo(rx+rw-a,ry+rh);
        ctx.moveTo(rx+a,ry+rh); ctx.lineTo(rx,ry+rh); ctx.lineTo(rx,ry+rh-a);
        ctx.stroke();
      }
    }
    // Barre PV
    const hpr=b.hp/b.maxHp;
    if(hpr<1||estSel(b.id)){
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(bx,by-9,pw,5);
      ctx.fillStyle=hpr>.6?'#2ecc71':hpr>.3?'#f39c12':'#e74c3c';
      ctx.fillRect(bx,by-9,pw*hpr,5);
    }
    // Barre de construction
    if(b.constructing){
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(bx,by+ph+2,pw,4);
      ctx.fillStyle='#3498db'; ctx.fillRect(bx,by+ph+2,pw*b.progress,4);
    }
    // Stock de nourriture de la ferme (vert) ; ferme vide = grisée + label
    if(b.type===BT.FARM&&!b.constructing){
      if(b.foodLeft>0){
        const fr=b.foodLeft/FARM_FOOD;
        ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(bx,by+ph+2,pw,4);
        ctx.fillStyle='#8fbc44'; ctx.fillRect(bx,by+ph+2,pw*fr,4);
      } else {
        ctx.globalAlpha=0.45; ctx.fillStyle='#000'; ctx.fillRect(Math.round(bx),Math.round(by),pw,ph); ctx.globalAlpha=1;
        ctx.fillStyle='#e8d5a0'; ctx.font='9px Cinzel,serif'; ctx.textAlign='center';
        ctx.fillText('récolte épuisée',bx+pw/2,by+ph/2);
      }
    }
    // File de formation
    if(b.trainQ.length>0){
      const tr=1-b.trainTimer/TTIME[b.trainQ[0]];
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(bx,by+ph+7,pw,4);
      ctx.fillStyle='#f1c40f'; ctx.fillRect(bx,by+ph+7,pw*tr,4);
      ctx.font='9px Cinzel,serif'; ctx.fillStyle='#f1c40f';
      ctx.textAlign='right';
      ctx.fillText(`×${b.trainQ.length}`,bx+pw-2,by+ph+18);
    }
  }
}

const UCOL={
  [UT.VIL]:'#3498db',[UT.MIL]:'#2176ae',[UT.ARC]:'#16a085',
  [UT.KNIGHT]:'#8e44ad',[UT.MONK]:'#d4ac0d',[UT.PALADIN]:'#9b59b6',
  [UT.PIKE]:'#2980b9',[UT.XBOW]:'#1abc9c',[UT.TREB]:'#7f6a4a',
  [UT.RAM]:'#6a4a28',[UT.SCOUT]:'#27ae60',[UT.HERO]:'#d4af37',[UT.BOAT]:'#4a90d9',
  [UT.CATA]:'#6c3483',[UT.CAVARC]:'#117a65',[UT.ARBRAP]:'#148f77',
  [UT.ENEMI]:'#e74c3c',[UT.ENEMIA]:'#c0392b',[UT.ENEMI_G]:'#7b241c',
  [UT.ENEMI_C]:'#a93226',[UT.ENEMI_BOSS]:'#641e16',
};

// Petit chariot animé sur chaque route commerciale active — purement
// cosmétique et calculé localement à partir de b.tradeRoute (synchronisé
// comme tout le reste du bâtiment côté hôte ; un client non-hôte peut ne pas
// voir l'anim tant que ce champ n'est pas répliqué, voir updateTradeRoutes).
function drawCaravans(){
  for(const b of G.buildings){
    if(b.type!==BT.MARKET||!b.tradeRoute||b.constructing) continue;
    if(!estLocal(b)&&G.fog.length){
      const fx=(b.tx/BASE_TILE)|0, fy=(b.ty/BASE_TILE)|0;
      if(G.fog[fy]&&G.fog[fy][fx]!==2) continue;
    }
    const p=caravanPos(b); if(!p) continue;
    const{x:sx,y:sy}=ws(p.x,p.y);
    if(sx<-TILE||sx>W+TILE||sy<48-TILE||sy>H+TILE) continue;
    if(SPR.caravan){
      const S=SPR.caravan.S*(TILE/(SPR.refT||TILE));
      ctx.drawImage(SPR.caravan.c,sx-S/2,sy-S/2,S,S);
    } else {
      ctx.font=Math.round(TILE*0.6)+'px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('🐫',sx,sy);
    }
  }
}

// Reliques encore au sol — masquées dès qu'un moine les porte (son état
// 'relic' suffit à le savoir, pas besoin de synchroniser relic.carrier) ou
// une fois mises à l'abri (bankedBy, lui synchronisé — voir construireDelta).
function drawRelics(){
  if(!G.relics||!G.relics.length) return;
  // Un seul balayage de G.units pour toutes les reliques, au lieu d'un
  // G.units.some() par relique et par image.
  let portees=null;
  for(const u of G.units) if(u.state==='relic') (portees||(portees=new Set())).add(u.target);
  for(const r of G.relics){
    if(r.bankedBy) continue;
    if(portees&&portees.has(r.id)) continue;
    const{x:sx,y:sy}=ws(r.x,r.y);
    if(sx<-TILE||sx>W+TILE||sy<48-TILE||sy>H+TILE) continue;
    if(G.fog.length){
      const fx=(r.tx|0), fy=(r.ty|0);
      if(G.fog[fy]&&G.fog[fy][fx]!==2) continue; // reliques non-mémorisées : invisibles hors vision actuelle
    }
    if(SPR.relic){
      const S=SPR.relic.S*(TILE/(SPR.refT||TILE));
      ctx.drawImage(SPR.relic.c,sx-S/2,sy-S/2,S,S);
    } else {
      ctx.font=Math.round(TILE*0.65)+'px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('🏺',sx,sy);
    }
  }
}

// Gibier sauvage encore en vie — une fois abattu il disparaît de G.wildlife
// (voir killWildlife) et sa dépouille prend le relais via drawNodes (RT.MEAT).
function drawWildlife(){
  if(!G.wildlife||!G.wildlife.length) return;
  for(const w of G.wildlife){
    if(w.hp<=0) continue;
    const{x:sx,y:sy}=ws(w.x,w.y);
    if(sx<-TILE||sx>W+TILE||sy<48-TILE||sy>H+TILE) continue;
    if(G.fog.length){
      const fx=(w.tx|0), fy=(w.ty|0);
      if(G.fog[fy]&&G.fog[fy][fx]!==2) continue;
    }
    const spr=SPR.wildlife&&SPR.wildlife[w.type];
    if(spr){
      const S=spr.S*(TILE/(SPR.refT||TILE));
      groundShadow(sx+S*0.06,sy+S*0.30,S*0.28,S*0.11,0.4);
      ctx.drawImage(spr.c,sx-S/2,sy-S/2,S,S);
    } else { // repli tant que buildSprites() n'a pas encore tourné
      ctx.font=Math.round(TILE*0.65)+'px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(WILDLIFE_DEF[w.type].ico,sx,sy);
    }
    if(w.hp<w.maxHp){ // barre de PV uniquement si déjà entamé
      const bw=TILE*0.6, by=sy-TILE*0.42;
      ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(sx-bw/2,by,bw,3);
      ctx.fillStyle='#e74c3c'; ctx.fillRect(sx-bw/2,by,bw*Math.max(0,w.hp/w.maxHp),3);
    }
  }
}

// Ordre de dessin des unités : de haut en bas de l'écran, pour que celle qui
// est DEVANT (plus bas) recouvre celle qui est derrière. Sans ce tri, deux
// unités superposées se recouvraient selon leur ordre de création — un
// villageois né il y a dix minutes passait devant un chevalier planté un
// demi-sprite plus bas. Sur une COPIE : l'ordre de G.units sert au reste du
// moteur (ciblage, réseau, sauvegardes) et ne doit pas bouger pour un
// détail d'affichage.
let _drawOrder=[];
// Aura de commandement des héros : +15 % d'ATK à tout allié dans un rayon de
// 6 cases (voir heroAuraMult). Cet effet ne se voyait NULLE PART — il fallait
// ouvrir la fiche de l'unité pour apprendre son existence, et rien à l'écran
// ne disait où placer ses troupes pour en profiter. Un cercle au sol, dessiné
// avant les unités pour passer dessous, rend la portée directement jouable.
function drawHeroAuras(){
  for(const u of G.units){
    if(u.type!==UT.HERO||u.hp<=0||u.state==='garrison') continue;
    const allie=!estHostile(u,G.me);
    if(!allie&&G.fog.length){ // aura ennemie : seulement si le héros est vu
      const fx=(u.x/BASE_TILE)|0, fy=(u.y/BASE_TILE)|0;
      if(G.fog[fy]&&G.fog[fy][fx]!==2) continue;
    }
    const{x:sx,y:sy}=ws(u.x,u.y);
    const r=HERO_AURA_RADIUS*(TILE/BASE_TILE);
    if(sx+r<0||sx-r>W||sy+r<54||sy-r>H) continue;
    const col=allie?'241,196,15':'231,76,60';
    ctx.save();
    ctx.setLineDash([9,7]);
    ctx.lineDashOffset=-(G.gameTime*10)%16;   // rotation lente : vivant sans clignoter
    // Cercle PARFAIT, pas une ellipse : la carte est rendue en projection
    // orthogonale stricte (ws() applique la même échelle en x et en y), et la
    // portée est testée par Math.hypot. Une ellipse aplatie promettrait un
    // rayon deux fois plus court vers le haut et vers le bas qu'il ne l'est.
    ctx.strokeStyle=`rgba(${col},.34)`; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle=`rgba(${col},.12)`; ctx.lineWidth=6;
    ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }
}

// Sprite d'une unité dans la variante de SA civilisation quand ce type en a
// une (voir UNIT_CIV_SPRITE_FILES) ; sinon la planche commune aux quatre
// camps, exactement comme avant. Même lookup que le civ-aware de
// drawBuildings, à un détail près qui compte : la table est interrogée AVANT
// civKeyOf. drawUnits passe ici pour chaque unité visible à chaque image —
// jusqu'à plusieurs centaines — alors qu'un seul type y a une entrée. Faire
// le fac() d'abord, ce serait le payer pour tout le monde afin de servir au
// plus quatre héros.
function sprUniteCiv(type,civ,suf,teinte){
  if(civ&&civ!=='francs'&&UNIT_CIV_SPRITE_FILES[type]&&UNIT_CIV_SPRITE_FILES[type][civ]){
    const s=sprTeinte('unitCiv',type+'_'+civ+suf,teinte);
    if(s) return s;
  }
  return sprTeinte('unit',type+suf,teinte);
}
function sprUnite(type,owner,suf,teinte){
  return UNIT_CIV_SPRITE_FILES[type]
    ? sprUniteCiv(type,civKeyOf(owner),suf,teinte)
    : sprTeinte('unit',type+suf,teinte);
}

function drawUnits(){
  // Écrémage AVANT le tri : en fin de partie l'immense majorité des unités
  // est hors écran ou sous le brouillard, et les trier toutes pour n'en
  // dessiner qu'une poignée revenait à payer un tri dix fois trop gros.
  _drawOrder.length=0;
  for(let i=0;i<G.units.length;i++){
    const u=G.units[i];
    if(u.state==='garrison') continue; // à l'abri dans le bâtiment : invisible
    const{x:sx,y:sy}=ws(u.x,u.y);
    if(sx<-TILE||sx>W+TILE||sy<48-TILE||sy>H+TILE) continue;
    // masquer ennemis dans le brouillard non-visible
    if(!estLocal(u)&&G.fog.length){
      const fx=(u.x/BASE_TILE)|0, fy=(u.y/BASE_TILE)|0;
      if(fx>=0&&fy>=0&&fx<COLS&&fy<ROWS&&G.fog[fy][fx]!==2) continue;
    }
    _drawOrder.push(u);
  }
  _drawOrder.sort((a,b)=>a.y-b.y);
  for(const u of _drawOrder){
    const{x:sx,y:sy}=ws(u.x,u.y);
    const teinteU=(fac(u)||{}).teinte||'rouge';
    const spr0=sprUnite(u.type,u.owner,'',teinteU);
    const S=(spr0?spr0.S:TILE*0.85)*(TILE/(SPR.refT||TILE));
    // bobbing en mouvement
    const bob=u.moving?Math.abs(Math.sin(u.animT*9))*2.5:0;
    // cycle de marche : alterne la pose de base et les 2 frames de foulée
    // au même rythme que le bobbing, pour rester synchronisé avec lui.
    let spr=spr0;
    if(u.moving){
      const cyc=Math.sin(u.animT*9);
      if(cyc>0.2&&SPR.unit[u.type+'_W1']) spr=sprUnite(u.type,u.owner,'_W1',teinteU);
      else if(cyc<-0.2&&SPR.unit[u.type+'_W2']) spr=sprUnite(u.type,u.owner,'_W2',teinteU);
    }
    // pichenette d'attaque : bref déplacement vers la cible juste après le
    // coup (atkCd revient à son maximum à l'impact), qui s'estompe vite —
    // sans ça, une unité en plein combat restait figée entre deux coups.
    let lungeX=0, lungeY=0;
    if(u.state==='attack'&&u.atkSpd){
      const cdMax=1/u.atkSpd;
      const f=Math.max(0,1-(1-u.atkCd/cdMax)*5);
      if(f>0){
        const amp=(u.rng>BASE_TILE*1.5?S*0.04:S*0.14)*f;
        lungeX=Math.cos(u.dir)*amp; lungeY=Math.sin(u.dir)*amp*0.4;
      }
    }
    const drawY=Math.round(sy-S*0.78-bob+lungeY);
    const drawX=Math.round(sx-S/2+lungeX);
    // ombre (toujours au sol, jamais soulevée par le bobbing : c'est le
    // décalage entre l'unité qui monte et son ombre qui reste plaquée qui
    // donne la sensation de pas)
    // Pas d'ombre portée sous une embarcation : sur l'eau, la tache sombre se
    // lirait comme un trou dans le lac. Sa coque dessine déjà son sillage.
    if(u.type!==UT.BOAT) groundShadow(sx+S*0.08,sy,S*0.40,S*0.18,0.85);
    // Liseré d'appartenance sous les unités ennemies. En mode Conquête,
    // l'adversaire aligne des VILLAGEOIS — dont le sprite est identique à
    // ceux du joueur : sans ce repère au sol, impossible de distinguer un
    // ouvrier ennemi du sien au milieu d'un gisement disputé.
    if(!estLocal(u)){
      ctx.strokeStyle='rgba(231,76,60,.55)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.ellipse(sx,sy,S*0.27,S*0.13,0,0,Math.PI*2); ctx.stroke();
    }
    // anneau de sélection
    if(estSel(u.id)){
      const pul=1+Math.sin(G.gameTime*4)*0.08; // pulsation douce
      ctx.strokeStyle='#f1c40f'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.ellipse(sx,sy,S*0.3*pul,S*0.15*pul,0,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle='rgba(241,196,15,.3)'; ctx.lineWidth=4;
      ctx.beginPath(); ctx.ellipse(sx,sy,S*0.3*pul,S*0.15*pul,0,0,Math.PI*2); ctx.stroke();
    }
    if(spr){
      const flip=Math.cos(u.dir)<-0.01; // regarde à gauche => miroir
      if(u.hitFlash>0){
        // flash blanc : on dessine le sprite puis un voile blanc en "source-atop"
        ctx.drawImage(spr.c,drawX,drawY,S,S);
        ctx.save(); ctx.globalAlpha=0.7; ctx.globalCompositeOperation='source-atop';
        ctx.fillStyle='#fff'; ctx.fillRect(drawX,drawY,S,S); ctx.restore();
      } else if(flip){
        ctx.save(); ctx.translate(drawX+S,drawY); ctx.scale(-1,1);
        ctx.drawImage(spr.c,0,0,S,S); ctx.restore();
      } else {
        ctx.drawImage(spr.c,drawX,drawY,S,S);
      }
    }
    // barre PV si blessé
    if(u.hp<u.maxHp){
      const hr=u.hp/u.maxHp, bw=S*0.7;
      ctx.fillStyle='#333'; ctx.fillRect(sx-bw/2,drawY-5,bw,3);
      ctx.fillStyle=hr>.5?'#2ecc71':hr>.25?'#f39c12':'#e74c3c';
      ctx.fillRect(sx-bw/2,drawY-5,bw*hr,3);
    }
    // couronne du boss
    if(u.type===UT.ENEMI_BOSS){
      ctx.font='13px serif'; ctx.textAlign='center'; ctx.fillText('👑',sx,drawY-6);
    }
    // insigne de vétérance
    if(u.rank>0){
      ctx.font='10px serif'; ctx.textAlign='center';
      ctx.fillText(RANK_THRESHOLDS[u.rank-1].ico,sx-S*0.32,drawY-2);
    }
    // icône d'état
    let icon=null, iconSize=9, relicGlow=false;
    if(u.state==='gather') icon='⛏'; else if(u.state==='return') icon='📦';
    else if(u.state==='build') icon='🔨'; else if(u.state==='heal') icon='✨';
    else if(u.state==='farm') icon='🌾';
    else if(u.state==='repair') icon='🛠';
    else if(u.state==='relic'){
      // relique en main vs. simple trajet vers elle — le premier cas doit
      // sauter aux yeux (c'est le seul état qui rapporte un revenu passif
      // en continu une fois livré) : icône agrandie + halo doré, pas juste
      // un pictogramme 9px identique aux autres états.
      icon=u.relicHeld?'🏺':'➡️';
      if(u.relicHeld){ iconSize=13; relicGlow=true; }
    }
    if(icon){
      if(relicGlow){
        const g=ctx.createRadialGradient(sx,drawY-6,0,sx,drawY-6,10);
        g.addColorStop(0,'rgba(255,214,110,.85)'); g.addColorStop(1,'rgba(255,214,110,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,drawY-6,10,0,Math.PI*2); ctx.fill();
      }
      ctx.font=iconSize+'px serif'; ctx.textAlign='center'; ctx.fillText(icon,sx,drawY-6);
    }
    // badge : ressources portées
    if(u.inv>0&&u.type===UT.VIL){
      const cols={[RT.TREE]:'#8fbc44',[RT.STONE]:'#d8d8e0',[RT.GOLD]:'#f0c040',[RT.BERRY]:'#e8907a',farm:'#e8d5a0'};
      ctx.fillStyle='rgba(0,0,0,.62)'; ctx.fillRect(sx+4,drawY-5,15,10);
      ctx.strokeStyle='rgba(0,0,0,.4)'; ctx.lineWidth=1; ctx.strokeRect(sx+4,drawY-5,15,10);
      ctx.font='bold 8px sans-serif'; ctx.textAlign='center';
      ctx.fillStyle=cols[u.invT]||'#fff'; ctx.fillText(u.inv|0,sx+11.5,drawY+3);
    }
  }
}

function drawProjs(){
  for(const p of G.projs){
    // progression 0→1 le long du tir initial : sert à courber la trajectoire
    // (arc parabolique) sans toucher à la logique de déplacement/collision,
    // qui continue de suivre la ligne droite réelle vers la cible.
    const dLeft=Math.hypot(p.tx-p.x,p.ty-p.y);
    const prog=p.d0?Math.min(1,Math.max(0,1-dLeft/p.d0)):0;
    const arc=Math.sin(prog*Math.PI); // 0 au départ/à l'arrivée, max au sommet
    if(p.siege){
      const{x:sx,y:sy}=ws(p.x,p.y);
      const lift=arc*Math.min(70,p.d0*0.14); // arche haute et lente : trajectoire de trébuchet
      const bsy=sy-lift;
      // ombre au sol qui suit le point d'impact réel, pas le boulet en l'air
      ctx.fillStyle='rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(sx,sy,5,2,0,0,Math.PI*2); ctx.fill();
      // boulet tournoyant (facettes qui tournent avec la progression du vol)
      ctx.save(); ctx.translate(sx,bsy); ctx.rotate(prog*14);
      ctx.fillStyle='#777'; ctx.beginPath(); ctx.arc(0,0,4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#999'; ctx.beginPath(); ctx.arc(-1,-1,1.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(0,0,0,.3)'; ctx.beginPath(); ctx.arc(1.5,1,1.2,0,Math.PI*2); ctx.fill();
      ctx.restore();
    } else {
      const{x:sx,y:sy}=ws(p.x,p.y);
      const lift=arc*Math.min(26,p.d0/BASE_TILE*7); // arc léger : lisible sans casser la lecture du tir tendu
      const bsy=sy-lift;
      // ombre au sol de la flèche en vol
      ctx.fillStyle='rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.ellipse(sx,sy,3,1.2,0,0,Math.PI*2); ctx.fill();
      // orientation tangente à l'arc (incline le nez vers le bas en fin de course)
      const ang=Math.atan2(p.ty-p.y,p.tx-p.x)+(prog-0.5)*0.5;
      ctx.save();
      ctx.translate(sx,bsy); ctx.rotate(ang);
      const col=(p.owner&&p.owner!==G.me)?'#e88':'#fd0'; // trait ennemi plus terne que le nôtre
      ctx.strokeStyle='#8a5a2a'; ctx.lineWidth=1.6;
      ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(4,0); ctx.stroke();
      ctx.fillStyle=col; // pointe
      ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(3,-2); ctx.lineTo(3,2); ctx.fill();
      ctx.fillStyle=col; // empennage : deux petites ailettes à l'arrière, la flèche se lit "en vol"
      ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(-9,-2.5); ctx.lineTo(-4.5,-0.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(-9,2.5); ctx.lineTo(-4.5,0.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

function drawParts(){
  // Étincelles rondes qui rétrécissent en s'estompant, avec un cœur clair —
  // avant, de simples carrés plats à taille fixe jusqu'à disparition.
  for(const p of G.parts){
    const{x:sx,y:sy}=ws(p.x,p.y);
    const life=Math.max(0,p.life);
    if(life<=0) continue;
    const s=Math.max(0.6,p.r*(0.35+life*0.65));
    ctx.globalAlpha=life;
    ctx.fillStyle=p.col;
    ctx.beginPath(); ctx.arc(sx,sy,s,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=life*0.55;
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(sx,sy,s*0.4,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
}

// Unités mortes : la silhouette bascule au sol et s'estompe (~0.6s) au lieu
// de disparaître d'un coup — purement visuel, ne touche à aucune logique
// de jeu (l'unité est déjà retirée de G.units à cet instant).
function drawDeathFx(){
  for(const d of G.deathfx){
    // Teinte du camp d'origine : sans elle, un assaillant ennemi mourait en
    // reprenant les couleurs du joueur le temps de sa chute.
    // La civilisation est figée dans l'enregistrement au moment de la mort :
    // le camp peut avoir disparu de G.factions le temps de la chute.
    const spr=d.teinte?sprUniteCiv(d.type,d.civ,'',d.teinte):SPR.unit[d.type];
    if(!spr) continue;
    const{x:sx,y:sy}=ws(d.x,d.y);
    const S=spr.S*(TILE/(SPR.refT||TILE));
    const fall=1-Math.max(0,Math.min(1,d.life)); // 0→1 : progression de la chute
    const up=S*(0.78-fall*0.68);
    const rot=(Math.cos(d.dir)<-0.01?-1:1)*fall*1.15;
    const scale=1-fall*0.2;
    // L'ombre s'étale et pâlit à mesure que le corps s'affaisse : sans elle,
    // la silhouette semblait basculer dans le vide.
    groundShadow(sx+S*0.08,sy,S*(0.30+fall*0.14),S*(0.13+fall*0.04),Math.max(0,d.life)*0.6);
    ctx.save();
    ctx.globalAlpha=Math.max(0,d.life)*0.9;
    ctx.translate(sx,sy-up);
    ctx.rotate(rot);
    ctx.scale(scale,scale);
    ctx.drawImage(spr.c,-S/2,-S/2,S,S);
    ctx.restore();
  }
  ctx.globalAlpha=1;
}

function drawFTexts(){
  for(const ft of G.ftexts){
    const{x:sx,y:sy}=ws(ft.x,ft.y);
    ctx.globalAlpha=Math.max(0,ft.life);
    ctx.font='bold 12px Cinzel,serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    // Contour sombre : un « +10 » doré sur de l'herbe éclairée était presque
    // illisible, et c'est précisément l'information qu'on lit du coin de l'œil.
    ctx.lineWidth=3; ctx.lineJoin='round'; ctx.strokeStyle='rgba(0,0,0,.75)';
    ctx.strokeText(ft.txt,sx,sy);
    ctx.fillStyle=ft.col||'#f1c40f';
    ctx.fillText(ft.txt,sx,sy);
  }
  ctx.globalAlpha=1;
}

function drawSelRings(){
  if(G.moveTarget&&G.mtTimer>0){
    const{x:sx,y:sy}=ws(G.moveTarget.x,G.moveTarget.y);
    // Deux anneaux qui se resserrent vers le point cliqué (au lieu d'un
    // cercle figé) : l'œil suit le mouvement et retrouve l'endroit visé même
    // au milieu d'une mêlée.
    const t=Math.max(0,Math.min(1,G.mtTimer));
    for(let i=0;i<2;i++){
      const f=Math.max(0,Math.min(1,t+i*0.28));
      const r=3+f*13;
      ctx.strokeStyle='rgba(241,196,15,'+(t*(1-i*0.45)).toFixed(2)+')';
      ctx.lineWidth=i?1:1.8;
      ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.stroke();
    }
    ctx.fillStyle='rgba(241,196,15,'+(t*0.8).toFixed(2)+')';
    ctx.beginPath(); ctx.arc(sx,sy,1.6,0,Math.PI*2); ctx.fill();
  }
  // Point de ralliement du bâtiment sélectionné — par l'index id -> entité,
  // reconstruit à chaque pas (rebuildGrid) : un balayage de G.buildings à
  // chaque image pour une réponse que la table donne directement.
  if(G.sel.length===1){
    const b=bldById(G.sel[0]);
    if(b&&b.rally){
      const{x:sx,y:sy}=ws(b.rally.x,b.rally.y);
      const{x:bx,y:by}=ws(b.x,b.y);
      ctx.strokeStyle='rgba(52,152,219,.5)'; ctx.lineWidth=1.5;
      ctx.setLineDash([6,5]);
      ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(sx,sy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#3498db'; ctx.font='16px serif'; ctx.textAlign='center';
      ctx.fillText('📍',sx,sy);
    }
  }
}

// Anneau de survol souris (desktop) — feedback léger avant de cliquer,
// distinct de l'anneau de sélection (plus fin, blanc, sans pulsation).
function drawHoverRing(){
  const h=G.hover;
  if(!h||G.mode!=='select') return;
  if(h.kind==='unit'){
    if(estSel(h.id)) return;
    const u=unitById(h.id); if(!u) return;
    const{x:sx,y:sy}=ws(u.x,u.y);
    const spr0=SPR.unit[u.type];
    const S=(spr0?spr0.S:TILE*0.85)*(TILE/(SPR.refT||TILE));
    ctx.strokeStyle='rgba(255,255,255,.65)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.ellipse(sx,sy,S*0.32,S*0.16,0,0,Math.PI*2); ctx.stroke();
  } else if(h.kind==='building'){
    if(estSel(h.id)) return;
    const b=bldById(h.id); if(!b) return;
    const pw=b.w*TILE, ph=b.h*TILE;
    const{x:sx,y:sy}=ws(b.x,b.y);
    const bx=sx-pw/2, by=sy-ph/2;
    ctx.strokeStyle='rgba(255,255,255,.55)'; ctx.lineWidth=1.5;
    ctx.strokeRect(Math.round(bx)-1,Math.round(by)-1,pw+2,ph+2);
  } else if(h.kind==='node'){
    const n=nodeById(h.id); if(!n) return;
    const{x:sx,y:sy}=ws(n.x,n.y);
    ctx.strokeStyle='rgba(255,255,255,.4)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(sx,sy,TILE*0.5,0,Math.PI*2); ctx.stroke();
  }
}

function drawGhost(){
  const g=G.ghost, d=BDEF[G.buildType];
  const sx=Math.round(g.tx*TILE-G.cam.x), sy=Math.round(g.ty*TILE-G.cam.y+54);
  const pw=d.w*TILE, ph=d.h*TILE;
  const col=g.valid?'#2ecc71':'#e74c3c';
  // Empreinte au sol D'ABORD, aperçu du bâtiment ensuite : peinte par-dessus
  // comme avant, la nappe verte ou rouge repeignait le sprite entier et on ne
  // distinguait plus quel bâtiment on était en train de poser.
  ctx.globalAlpha=.30;
  ctx.fillStyle=col; ctx.fillRect(sx,sy,pw,ph);
  ctx.globalAlpha=1;
  const spr=SPR.bld[G.buildType];
  if(spr){
    ctx.globalAlpha=.72;
    const kg=TILE/(SPR.refT||TILE);
    ctx.drawImage(spr.c,sx,sy-spr.oy*kg,spr.dw*kg,spr.dh*kg);
    ctx.globalAlpha=1;
  }
  // Contour en pointillés qui défilent : signale « ceci n'est pas encore
  // construit » sans rien ajouter de statique à l'écran.
  ctx.strokeStyle=col; ctx.lineWidth=2;
  ctx.setLineDash([7,4]); ctx.lineDashOffset=-(G.gameTime*14)%11;
  ctx.strokeRect(sx,sy,pw,ph);
  ctx.setLineDash([]); ctx.lineDashOffset=0;
}

// Valeur de brouillard à une case tuile (0=inexploré 1=exploré 2=visible) ;
// 2 par défaut tant que G.fog n'existe pas encore (avant la 1ère revealFog).
function fogTileAt(tx,ty){
  if(!G.fog.length) return 2;
  if(tx<0||ty<0||tx>=COLS||ty>=ROWS) return 0;
  return G.fog[ty][tx];
}
// ── MINI-CARTE ───────────────────────────────────────
// Le fond (terrain + brouillard + gisements) balayait les 240×240 = 57 600
// cases de la carte À CHAQUE IMAGE, soit ~0,8 ms constants quel que soit le
// zoom — pour un résultat qui ne change qu'au rythme de revealFog, cinq fois
// par seconde. Il est désormais peint dans un canvas à part, réutilisé tant
// que le brouillard n'a pas bougé ; seuls les bâtiments, les unités et le
// cadre de vue — qui, eux, bougent vraiment à chaque image — restent peints
// par-dessus.
let _mmFond=null, _mmFondVer=-1, _mmFondTaille='';
const MM_NODE_COL={ [RT.TREE]:'#2d6b22',[RT.STONE]:'#888',[RT.GOLD]:'#d4a017',[RT.BERRY]:'#c0392b' };

function dessinerFondMinimap(mw,mh,K,scx,scy){
  if(!_mmFond||_mmFond.c.width!==mw||_mmFond.c.height!==mh){
    _mmFond=offCanvas(mw,mh);
    _mmFondVer=-1;
  }
  const taille=mw+'x'+mh;
  if(_mmFondVer===G.fogVer&&_mmFondTaille===taille) return _mmFond.c;
  _mmFondVer=G.fogVer; _mmFondTaille=taille;
  const g=_mmFond.cx;
  // Fond noir par défaut = inexploré, comme dans AoE2 : hors de propos de
  // dévoiler à la souris ce que le joueur n'a jamais exploré à l'écran.
  g.globalAlpha=1;
  g.fillStyle='#000'; g.fillRect(0,0,mw,mh);
  // Terrain (herbe/eau) : uniquement sur les cases déjà explorées.
  // Le sol suit le type de carte (voir SOLS) — une carte aride doit se lire
  // ocre en miniature comme elle se lit ocre à l'écran.
  const solMini=solCfg().mini;
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
    const f=fogTileAt(x,y);
    if(f===0) continue;
    g.fillStyle=G.tiles[y][x]===T_WATER?'#2472a4':solMini;
    if(f===1) g.globalAlpha=0.55; // exploré mais hors vue actuelle : assombri
    g.fillRect(x*scx*BASE_TILE,y*scy*BASE_TILE,scx*BASE_TILE+1,scy*BASE_TILE+1);
    g.globalAlpha=1;
  }
  // Ressources : mémorisées une fois explorées (comme le terrain)
  for(const n of G.nodes){
    if(n.amt<=0) continue;
    if(fogTileAt(n.tx,n.ty)===0) continue;
    g.fillStyle=MM_NODE_COL[n.type];
    // Gisements : un point de 2 unités (et non 3, qui débordait sur deux
    // cases voisines et transformait une forêt en confettis illisibles).
    g.fillRect(n.tx*scx*BASE_TILE-K/2,n.ty*scy*BASE_TILE-K/2,2*K,2*K);
  }
  return _mmFond.c;
}

function drawMinimap(){
  // Dimensions lues sur le canevas (176×176 pour 88 CSS) : la mini-carte est
  // rendue au double de sa taille d'affichage, donc nette sur écran HiDPI et
  // encore nette une fois agrandie sur grand écran (voir la règle @media).
  const mw=mm.width,mh=mm.height, K=mw/88;
  const scx=mw/(COLS*BASE_TILE), scy=mh/(ROWS*BASE_TILE);
  mctx.drawImage(dessinerFondMinimap(mw,mh,K,scx,scy),0,0);
  // Bâtiments : les nôtres toujours visibles, ceux ennemis seulement une
  // fois leur case explorée (mémorisés ensuite, comme sur la carte).
  for(const b of G.buildings){
    if(!estLocal(b)&&fogTileAt(b.tx,b.ty)===0) continue;
    mctx.fillStyle=couleurMinimap(b,false);
    mctx.fillRect(b.tx*scx*BASE_TILE,b.ty*scy*BASE_TILE,b.w*scx*BASE_TILE+2*K,b.h*scy*BASE_TILE+2*K);
  }
  // Unités : les nôtres toujours visibles, celles ennemies seulement dans
  // le rayon de vision actuel (elles disparaissent hors de vue, contrairement
  // aux bâtiments qui laissent une trace mémorisée).
  for(const u of G.units){
    if(u.state==='garrison') continue;
    if(!estLocal(u)&&fogTileAt((u.x/BASE_TILE)|0,(u.y/BASE_TILE)|0)!==2) continue;
    mctx.fillStyle=couleurMinimap(u,true);
    mctx.fillRect(u.x*scx-1.5*K,u.y*scy-1.5*K,3*K,3*K);
  }
  // Viewport — G.cam et W/gameH() sont en pixels écran zoomés, scx/scy en
  // unités-monde : on divise par l'échelle pour repasser en unités-monde.
  const S=TILE/BASE_TILE;
  const vx=G.cam.x/S*scx, vy=G.cam.y/S*scy, vw=W/S*scx, vh=gameH()/S*scy;
  // Cadre de vue : trait sombre dessous, doré dessus — sur une forêt claire
  // comme sur du noir inexploré, il reste visible dans les deux cas.
  mctx.strokeStyle='rgba(0,0,0,.6)'; mctx.lineWidth=3*K;
  mctx.strokeRect(vx,vy,vw,vh);
  mctx.strokeStyle='#f1c40f'; mctx.lineWidth=1.4*K;
  mctx.strokeRect(vx,vy,vw,vh);
}
