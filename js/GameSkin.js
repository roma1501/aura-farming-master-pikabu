// GameSkin.js — внешний вид интерфейса Aura Farming Master: «неон/стрит». Тёмные панели со срезанными
// углами, неоновые обводки (розовый / голубой / жёлтый / фиолет), наклейки-плашки, шрифт Rubik
// (GameFont в index.html). Модуль только перекрашивает и раскладывает DOM других модулей (GameUI,
// GameInput, GameModes, GameWardrobe, GameDaily, GameTutorial, GameFarm): стиль добавляется ПОСЛЕДНИМ
// (init идёт после всех), поэтому одинаковой специфичности селекторов хватает. Раскладка HUD:
// слева сверху — аура и серия, справа сверху — рейка кнопок (звук, настройки, магазин, прокачка, гардероб,
// подарок, «Лобби»), по центру — режим и таймер зоны, справа снизу — «Поза» и малый «Рывок».

/** @satisfies {Record<string, any>} */
const GameSkin = {
    init(game) {
        const st = document.createElement('style');
        st.id = 'game-skin';
        st.textContent = GameSkin.CSS;
        document.head.appendChild(st);
        // «Лобби» живёт в рейке справа (GameModes кладёт кнопку в body).
        const rail = document.getElementById('gu-rail'), home = document.getElementById('gm-home');
        if (rail && home) rail.appendChild(home);
        void game;
    },

    CSS: `
:root{--n-pink:#ff3fa8;--n-cyan:#3fe8ff;--n-yel:#ffe14d;--n-vio:#9a5cff;--n-bg:#0d0620;--n-panel:#150a30}
html,body{background-color:#07030f}
/* --- рейка справа сверху --- */
#gu-rail{position:absolute;right:calc(12px + env(safe-area-inset-right));top:calc(10px + env(safe-area-inset-top));display:flex;flex-direction:column;align-items:flex-end;gap:8px;
 max-height:calc(100% - 230px);flex-wrap:wrap-reverse;align-content:flex-end;pointer-events:none}
#gu-rail>*{pointer-events:auto}
.gu-rail-ic{display:flex;gap:8px}
#gu-gear,#gu-snd{position:static;width:46px;height:46px;padding:8px;box-sizing:border-box;border-radius:4px;border:2px solid var(--n-cyan);background:rgba(13,6,32,.85);
 box-shadow:0 0 10px rgba(63,232,255,.5);cursor:pointer;pointer-events:auto;transform:none;-webkit-tap-highlight-color:transparent;
 clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px))}
#gu-snd img,#gu-gear img{width:100%;height:100%;filter:brightness(0) invert(1) drop-shadow(0 0 4px var(--n-cyan))}
#gu-snd.gu-offb{border-color:var(--n-pink);box-shadow:0 0 10px rgba(255,63,168,.55)}
#gu-gear:active,#gu-snd:active{transform:scale(.94)}
#gu-rail .gu-hbtn,#gu-rail #gm-home{position:relative;display:flex;align-items:center;gap:6px;height:42px;padding:0 14px 0 6px;border-radius:4px;border:2px solid var(--n-cyan);
 background:linear-gradient(90deg,rgba(13,6,32,.92),rgba(40,14,80,.92));color:#fff;font:800 16px/1 GameFont,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.6px;
 text-shadow:0 0 8px var(--n-cyan);box-shadow:0 0 10px rgba(63,232,255,.45);cursor:pointer;
 clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))}
#gu-rail #gm-home{top:auto;right:auto;z-index:auto;border-color:var(--n-vio);text-shadow:0 0 8px var(--n-vio);display:none}
#gu-rail #gm-home.gm-on{display:flex}
#gu-rail .gu-hbtn img,#gu-rail #gm-home img{width:28px;height:28px}
#gu-rail .gu-th-pink{border-color:var(--n-pink);text-shadow:0 0 8px var(--n-pink);box-shadow:0 0 10px rgba(255,63,168,.5)}
#gu-rail .gu-th-gold{border-color:var(--n-yel);text-shadow:0 0 8px #ff9a2f;box-shadow:0 0 10px rgba(255,225,77,.45)}
#gu-rail .gu-th-purple{border-color:var(--n-vio);text-shadow:0 0 8px var(--n-vio);box-shadow:0 0 10px rgba(154,92,255,.5)}
#gu-rail .gu-th-green{border-color:#5dffb0;text-shadow:0 0 8px #5dffb0}
#gu-rail .gu-hbtn .gu-dot{right:-6px;top:-7px;border-radius:3px;background:var(--n-pink);border-color:#fff}
/* --- левый верх: аура --- */
#gu-aura{height:48px;padding:0 16px 0 6px;border-radius:4px;background:rgba(13,6,32,.85);border:2px solid var(--n-pink);box-shadow:0 0 12px rgba(255,63,168,.55);
 clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))}
#gu-aura .gu-aura-l{font-size:14px;letter-spacing:2px;color:var(--n-cyan);text-shadow:0 0 8px var(--n-cyan)}
#gu-aura .gu-aura-n{font-size:30px;color:var(--n-yel);text-shadow:0 0 10px #ff9a2f,2px 2px 0 #7a1a5c}
#gu-boost{border-radius:4px;border:2px solid var(--n-yel);background:rgba(13,6,32,.85);box-shadow:0 0 10px rgba(255,225,77,.5);color:var(--n-yel);text-shadow:0 0 8px #ff9a2f}
#gu-mode{top:calc(10px + env(safe-area-inset-top));border-radius:4px;background:rgba(13,6,32,.85)!important;border:2px solid var(--n-cyan);color:#fff;text-transform:uppercase;letter-spacing:3px;font-size:18px;
 text-shadow:0 0 10px var(--n-cyan);box-shadow:0 0 12px rgba(63,232,255,.5);padding:6px 20px}
.gu-t{border-radius:4px;background:rgba(13,6,32,.9);border:2px solid var(--n-vio);box-shadow:0 0 14px rgba(154,92,255,.55);text-shadow:0 0 8px var(--n-vio)}
#gu-feed{font-weight:700}
/* --- метки режима и пиллы (GameModes) --- */
.gm-pill{border-radius:4px;background:rgba(13,6,32,.85);border:2px solid var(--n-cyan);box-shadow:0 0 12px rgba(63,232,255,.5);text-transform:uppercase;letter-spacing:2px;text-shadow:0 0 8px var(--n-cyan)}
.gm-pill.gm-m-arena,.gm-pill.gm-m-hardcore,.gm-pill.gm-m-royale,.gm-pill.gm-m-duel{background:rgba(13,6,32,.85);border-color:var(--n-pink)}
.gm-pill.gm-warn{background:rgba(60,8,40,.9);border-color:var(--n-pink)}
#gm-big{text-shadow:0 0 14px var(--n-pink),0 0 34px var(--n-pink),-4px 0 var(--n-cyan),4px 0 var(--n-pink),0 7px 0 rgba(0,0,0,.4)}
#gm-big.gm-go{color:#bfffd8}
.gm-st{border-radius:4px;background:rgba(154,92,255,.12);border:2px solid rgba(154,92,255,.45)}
.gm-st small{color:#cdb6ff}
.gm-rew{border-radius:4px;border-color:var(--n-pink);background:linear-gradient(#5a1a8a,#2a0f4a);box-shadow:0 0 14px var(--n-pink)}
.gm-dot.gm-in{background:var(--n-cyan);border-color:#fff}
.gm-spin{border-top-color:var(--n-pink)}
/* --- диалоги --- */
.gu-mwrap{background:rgba(6,2,16,.62)}
.gu-modal{border-radius:4px;border:2px solid var(--n-cyan);background:linear-gradient(165deg,#1b0b3c,#0d0620 70%);
 box-shadow:0 0 24px rgba(63,232,255,.5),inset 0 0 26px rgba(154,92,255,.18);clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))}
.gu-modal .gu-mh{min-height:50px;font-size:23px;text-transform:uppercase;letter-spacing:3px;background:linear-gradient(90deg,#34106a,#7a1a8e 55%,#34106a);border-bottom:2px solid var(--n-pink);
 text-shadow:0 0 10px var(--n-pink),0 0 20px var(--n-pink)}
.gu-x{border-radius:4px;border:2px solid var(--n-pink);background:#2a0f4a;box-shadow:0 0 8px var(--n-pink)}
.gu-mb{text-shadow:none}
.gu-b{border-radius:4px;border:2px solid #5dffb0;color:#fff;text-transform:uppercase;letter-spacing:.8px;font-weight:800;text-shadow:0 0 8px rgba(93,255,176,.8);
 background:linear-gradient(#1a6a4c,#0d3a2c);box-shadow:0 0 12px rgba(93,255,176,.45),inset 0 0 8px rgba(93,255,176,.25);
 clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px))}
.gu-b:active{transform:translateY(2px);box-shadow:0 0 6px rgba(93,255,176,.45)}
.gu-b.gu-k-orange{border-color:#ffb43a;background:linear-gradient(#6a4210,#3a2208);text-shadow:0 0 8px #ffb43a;box-shadow:0 0 12px rgba(255,180,58,.45)}
.gu-b.gu-k-blue{border-color:var(--n-cyan);background:linear-gradient(#15486a,#0b2440);text-shadow:0 0 8px var(--n-cyan);box-shadow:0 0 12px rgba(63,232,255,.45)}
.gu-b.gu-k-red{border-color:var(--n-pink);background:linear-gradient(#6a1546,#3a0b28);text-shadow:0 0 8px var(--n-pink);box-shadow:0 0 12px rgba(255,63,168,.45)}
.gu-b.gu-k-gray{border-color:#9aa6c0;background:linear-gradient(#3a4256,#222838);text-shadow:none;box-shadow:none}
.gu-b.gu-k-gold{border-color:var(--n-yel);background:linear-gradient(#6a5a10,#3a3008);text-shadow:0 0 8px var(--n-yel);box-shadow:0 0 12px rgba(255,225,77,.45)}
.gu-b.gu-k-ad{border-color:var(--n-vio);background:linear-gradient(#45208a,#240f4a);text-shadow:0 0 8px var(--n-vio);box-shadow:0 0 12px rgba(154,92,255,.5)}
.gu-b[disabled]{filter:grayscale(.8) brightness(.7);box-shadow:none}
.gu-tg.gu-offb{border-color:var(--n-pink);background:linear-gradient(#6a1546,#3a0b28)}
.gu-m-shop{background:#0d0620}
.gu-card{border-radius:4px;border:2px solid #6a3fc0;background:linear-gradient(#24104a,#150a30);box-shadow:inset 0 0 12px rgba(154,92,255,.18)}
.gu-ci .gu-x2{border-radius:3px;border-color:var(--n-yel);background:#2a0f4a;color:var(--n-yel);text-shadow:0 0 6px #ff9a2f}
.gu-cn.gu-on{color:var(--n-yel)}
.gu-rrow{border-radius:4px;background:rgba(154,92,255,.12)}
.gu-rrow:nth-child(odd){background:rgba(154,92,255,.2)}
.gu-rrow.gu-me{background:linear-gradient(90deg,#6a5a10,#a0701a);color:#fff;border:1px solid var(--n-yel)}
.gu-rrow.gu-me .gu-rs{color:#fff}
.gu-rs{color:var(--n-yel)}
.gu-rk{border-radius:3px}
.gu-cred h3{color:var(--n-cyan);letter-spacing:1px}
/* --- бейджи над головами --- */
.gu-ar .o{-webkit-text-stroke:8px #1b0b3c;color:#1b0b3c}
.gu-ar .f{background:linear-gradient(180deg,#fff27a 0%,#ffb03a 50%,#ff5a9a 100%);-webkit-background-clip:text;background-clip:text}
.gu-nm{text-shadow:-2px 0 0 #1b0b3c,2px 0 0 #1b0b3c,0 -2px 0 #1b0b3c,0 2px 0 #1b0b3c,-1.5px -1.5px 0 #1b0b3c,1.5px -1.5px 0 #1b0b3c,-1.5px 1.5px 0 #1b0b3c,1.5px 1.5px 0 #1b0b3c,0 0 8px var(--n-pink)}
.gu-nm img{border-color:var(--n-cyan);box-shadow:0 0 0 2px #1b0b3c,0 0 8px var(--n-cyan);background:#2a0f4a}
.gu-bub{border-radius:4px;background:rgba(255,248,255,.96);color:#1b0b3c;box-shadow:0 0 10px rgba(255,63,168,.5)}
.gu-plus{color:var(--n-yel);text-shadow:-2px -2px 0 #7a1a5c,2px -2px 0 #7a1a5c,-2px 2px 0 #7a1a5c,2px 2px 0 #7a1a5c,0 0 14px var(--n-pink)}
.gu-minus{text-shadow:-2px -2px 0 #1b0b3c,2px -2px 0 #1b0b3c,-2px 2px 0 #1b0b3c,2px 2px 0 #1b0b3c}
/* --- старт --- */
#gu-start{background:radial-gradient(ellipse at 50% 42%,rgba(20,5,50,0) 30%,rgba(10,3,30,.62) 100%)}
.gu-logo2{display:flex;flex-direction:column;align-items:center;text-align:center;font:900 clamp(50px,11vw,132px)/.9 GameFont,system-ui,sans-serif;font-style:italic;text-transform:uppercase;
 letter-spacing:.02em;color:#fff7f0;text-shadow:0 0 6px #fff,0 0 20px var(--n-pink),0 0 44px var(--n-pink),5px 5px 0 #6a1a8a;animation:gu-float 3s ease-in-out infinite}
.gu-logo2 small{margin-top:.2em;font-size:.3em;letter-spacing:.55em;font-style:normal;color:var(--n-cyan);text-shadow:0 0 12px var(--n-cyan);padding-left:.55em}
.gu-play{border-radius:4px;border:3px solid var(--n-pink);background:linear-gradient(#7a1a8e,#2a0f5a);text-transform:uppercase;letter-spacing:4px;
 text-shadow:0 0 12px var(--n-pink);box-shadow:0 0 26px var(--n-pink),inset 0 0 18px rgba(255,63,168,.35);
 clip-path:polygon(0 0,calc(100% - 18px) 0,100% 18px,100% 100%,18px 100%,0 calc(100% - 18px))}
.gu-play:active{box-shadow:0 0 12px var(--n-pink)}
.gu-sb{border-radius:4px;border:2px solid var(--n-cyan);background:rgba(13,6,32,.85);box-shadow:0 0 12px rgba(63,232,255,.5);text-transform:uppercase;letter-spacing:1px;text-shadow:0 0 8px var(--n-cyan);
 clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px))}
/* --- кнопки управления: «Рывок» малый слева от «Позы» --- */
#gi-dash{right:calc(188px + env(safe-area-inset-right));bottom:calc(60px + env(safe-area-inset-bottom));width:82px;height:82px;font-size:13px;border:3px solid var(--n-cyan);
 background:radial-gradient(circle at 50% 35%,#15486a,#0b1a3a 75%);box-shadow:0 0 14px rgba(63,232,255,.65),inset 0 0 12px rgba(63,232,255,.3);text-shadow:0 0 8px var(--n-cyan)}
#gi-dash img{width:34px;height:34px;filter:drop-shadow(0 0 5px var(--n-cyan))}
#gi-dash .gi-kbd{border-radius:4px;border:2px solid var(--n-cyan);background:#0d0620;color:#fff;box-shadow:none}
#gi-dash .gi-ring{stroke:var(--n-yel)}
#gi-dash.gi-mobile{right:calc(156px + env(safe-area-inset-right));bottom:calc(max(64px,8.5vh) + env(safe-area-inset-bottom));width:70px;height:70px;font-size:12px}
#gi-dash.gi-mobile img{width:30px;height:30px}
@media (max-height:430px){#gi-dash.gi-mobile{bottom:calc(50px + env(safe-area-inset-bottom));right:calc(140px + env(safe-area-inset-right))}}
/* --- гардероб --- */
.gw-panel{border-radius:4px;border:2px solid var(--n-cyan);background:#0d0620;box-shadow:0 0 24px rgba(63,232,255,.5)}
.gw-head{background:linear-gradient(90deg,#34106a,#7a1a8e 55%,#34106a);border-bottom:2px solid var(--n-pink)}
.gw-title{text-transform:uppercase;letter-spacing:3px;text-shadow:0 0 10px var(--n-pink)}
.gw-bal{border-radius:4px;border:2px solid var(--n-yel);background:rgba(13,6,32,.85);color:var(--n-yel)}
.gw-x{border-radius:4px;border:2px solid var(--n-pink);background:#2a0f4a;box-shadow:0 0 8px var(--n-pink)}
.gw-tabs{background:#12082a}
.gw-tab{border-radius:4px 4px 0 0;border-color:#4a2a8a;background:linear-gradient(#24104a,#150a30);color:#cdb6ff}
.gw-tab.gw-act{background:linear-gradient(#7a1a8e,#3a1070);color:#fff;border-color:var(--n-pink);box-shadow:0 0 10px rgba(255,63,168,.6)}
.gw-card{border-radius:4px;border:2px solid #4a2a8a;background:linear-gradient(#24104a,#150a30)}
.gw-card.gw-on{background:linear-gradient(#14583a,#0a3424);border-color:#5dffb0}
.gw-card.gw-try{border-color:var(--n-cyan)}
.gw-card.gw-sel{border-color:var(--n-yel);box-shadow:0 0 10px var(--n-yel)}
.gw-ic{border-radius:3px}
.gw-t-gift,.gw-t-aura{color:var(--n-yel)}
.gw-new{border-radius:3px;background:var(--n-pink)}
.gw-foot{background:#12082a;border-top:2px solid #4a2a8a}
.gw-b{border-radius:4px;border:2px solid #5dffb0;background:linear-gradient(#1a6a4c,#0d3a2c);text-transform:uppercase}
/* --- подарок --- */
.gd-card{border-radius:4px;border:2px solid #4a2a8a;background:linear-gradient(#24104a,#150a30)}
.gd-card.gd-got{background:linear-gradient(#14583a,#0a3424);border-color:#5dffb0}
.gd-card.gd-cur{background:linear-gradient(#7a1a8e,#3a1070);border-color:var(--n-yel)}
.gd-card.gd-cur .gd-dn,.gd-card.gd-cur .gd-tag{text-shadow:0 0 8px var(--n-pink)}
.gd-card.gd-now{box-shadow:0 0 0 2px var(--n-yel),0 0 16px var(--n-yel)}
.gd-card.gd-d7{background:linear-gradient(#5a1a8a,#24104a);border-color:var(--n-pink)}
.gd-info b{color:var(--n-yel)}
/* --- обучение --- */
#gt-card{border-radius:4px;border:2px solid var(--n-cyan);background:linear-gradient(160deg,#1b0b3c,#0d0620);box-shadow:0 0 22px rgba(63,232,255,.5);
 clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px))}
#gt-card .gt-ic{border-radius:4px;background:rgba(154,92,255,.2)}
#gt-card .gt-t{text-transform:uppercase;letter-spacing:2px;text-shadow:0 0 10px var(--n-pink)}
#gt-card.gt-done{background:linear-gradient(160deg,#14583a,#0a2a1c);border-color:#5dffb0}
#gt-card .gt-dots i{border-color:#4a2a8a;border-radius:2px}
#gt-card .gt-dots i.on{background:var(--n-pink)}
#gt-card .gt-skip{color:var(--n-cyan)}
#gi-dash.gt-hl{animation:gt-pulse 1s ease-in-out infinite}
/* --- узкий экран --- */
@media (max-width:560px){
 #gm-top.gm-low{left:calc(12px + env(safe-area-inset-left));right:auto;top:calc(62px + env(safe-area-inset-top));transform:none;align-items:flex-start;scale:.85;transform-origin:0 0}
 #gu-mode{display:none!important}
 #gu-rail .gu-hbtn,#gu-rail #gm-home{height:38px;font-size:14px;padding:0 10px 0 4px}
 #gu-rail .gu-hbtn img,#gu-rail #gm-home img{width:24px;height:24px}
 #gu-aura{height:44px}
 #gu-aura .gu-aura-n{font-size:26px}
}
@media (max-height:430px){
 #gu-rail{max-height:calc(100% - 130px)}
 #gu-rail .gu-hbtn,#gu-rail #gm-home{height:34px;font-size:13px}
 #gu-gear,#gu-snd{width:38px;height:38px;padding:6px}
 #gu-tl{transform:scale(.8)}
 #gf-plate{top:calc(46px + env(safe-area-inset-top));scale:.85;transform-origin:50% 0}
}
`,
};
