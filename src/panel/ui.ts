/**
 * La página del panel, entera. Pensada primero para el móvil del dueño.
 * El JS de dentro no usa
 * comillas invertidas para no romper esta plantilla.
 */

export const PAGE = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>{{PANEL_TITLE}}</title>
<style>
:root{
  --bg:#f7f4ec; --panel:#fffdf8; --ink:#26323f; --muted:#6b7280; --line:#e6ddca;
  --accent:#c1673f; --accent-ink:#fff; --soft:#f6efe1; --ok:#4a5a3a; --bad:#a3322a; --warn:#9a6a12;
  --user:#26323f; --user-ink:#f7f4ec;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --bg:#171c22; --panel:#1f262e; --ink:#ece7dc; --muted:#9aa3ad; --line:#303a45;
  --accent:#d67b52; --accent-ink:#1a1a1a; --soft:#262f38; --ok:#9bb17f; --bad:#e0796f; --warn:#e2b25a;
  --user:#d8c4a0; --user-ink:#1a1f25;
}}
:root[data-theme="dark"]{
  --bg:#171c22; --panel:#1f262e; --ink:#ece7dc; --muted:#9aa3ad; --line:#303a45;
  --accent:#d67b52; --accent-ink:#1a1a1a; --soft:#262f38; --ok:#9bb17f; --bad:#e0796f; --warn:#e2b25a;
  --user:#d8c4a0; --user-ink:#1a1f25;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
h1,h2{font-family:Georgia,"Playfair Display",serif;font-weight:600;margin:0}
button{font:inherit;cursor:pointer}
.hidden{display:none!important}

/* Entrar */
#login{min-height:100%;display:grid;place-items:center;padding:24px 16px}
#login form{width:100%;max-width:340px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px 22px;display:grid;gap:14px}
#login h1{font-size:26px}
#login p{margin:0;color:var(--muted);font-size:14px}
label{display:grid;gap:6px;font-size:14px;color:var(--muted)}
input[type=text],input[type=password],textarea{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
.primary{background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:12px 16px;font-weight:600}
.primary:disabled{opacity:.55;cursor:default}
.ghost{background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px 14px}
.error{color:var(--bad);font-size:14px;min-height:1.2em}
.pass{position:relative}
.pass input{padding-right:48px}
#eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:40px;height:40px;border:0;background:none;color:var(--muted);display:grid;place-items:center;border-radius:8px}
#eye:hover{color:var(--ink)}
#eye:focus-visible{outline:2px solid var(--accent)}

/* Dos pasos */
#twofa{min-height:100%;display:grid;place-items:center;padding:24px 16px}
#twofa form{width:100%;max-width:420px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px 22px;display:grid;gap:14px}
#twofa h1{font-size:24px}
#twofa ol{margin:0;padding-left:20px;display:grid;gap:8px;font-size:15px}
#twofa .qr{display:grid;place-items:center;background:#fff;border-radius:12px;padding:8px;justify-self:center}
#twofa .qr img{width:200px;height:200px;image-rendering:pixelated;display:block}
#twofa code{font:600 15px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.04em;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:block}
.code-input{font:600 22px/1 ui-monospace,SFMono-Regular,Consolas,monospace!important;letter-spacing:.3em;text-align:center}

/* App */
#app{height:100%;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg);position:sticky;top:0;z-index:2}
header h1{font-size:18px;line-height:1.2;flex:1;min-width:0}
#menu{display:none;background:none;border:0;color:var(--ink);width:40px;height:40px;margin:-8px 0 -8px -8px;border-radius:8px;place-items:center}
#menu:focus-visible{outline:2px solid var(--accent)}
#logout{background:none;border:0;color:var(--muted);font-size:13px;padding:6px}
#body{flex:1;display:flex;min-height:0}
#pane{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
#pane > *{width:100%;max-width:760px;margin-left:auto;margin-right:auto}

/* Menú de la izquierda: secciones y conversaciones */
#side{width:260px;flex:none;border-right:1px solid var(--line);background:var(--soft);overflow-y:auto;padding:14px 10px;display:flex;flex-direction:column;gap:18px}
.nav{display:grid;gap:2px}
.nav button{display:flex;align-items:center;gap:10px;text-align:left;background:none;border:0;border-radius:10px;padding:10px 12px;color:var(--ink);font-size:15px}
.nav button svg{flex:none;color:var(--muted)}
.nav button:hover{background:var(--panel)}
.nav button[aria-current=page]{background:var(--panel);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.nav button[aria-current=page] svg{color:var(--accent)}
#chatsBox .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px 6px}
#chatsBox .head b{font-size:13px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
#chatList{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:2px}
#chatList li{display:flex;align-items:center;border-radius:10px;min-width:0}
#chatList li:hover{background:var(--panel)}
#chatList li.active{background:var(--panel);box-shadow:inset 3px 0 0 var(--accent)}
#chatList .pick{flex:1;min-width:0;background:none;border:0;text-align:left;padding:9px 10px;color:var(--ink);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#chatList li.active .pick{font-weight:600}
#chatList .del{flex:none;background:none;border:0;color:var(--muted);width:34px;height:34px;border-radius:8px;display:grid;place-items:center}
#chatList .del:hover{color:var(--bad)}
#chatList .del[aria-label^="Cambiar"]:hover{color:var(--ink)}
#chatList .del{width:30px}
#chatList .del[hidden]{display:none}
#chatList .rename{flex:1;min-width:0;font-size:14px;padding:7px 9px;margin:1px 0}
#sideError{color:var(--bad);font-size:13px;padding:0 4px}
#sideError:empty{display:none}
#scrim{display:none}
@media (max-width:899px){
  #menu{display:grid}
  #side{position:fixed;top:0;bottom:0;left:0;z-index:20;width:min(300px,86vw);transform:translateX(-100%);transition:transform .2s;box-shadow:0 0 24px rgba(0,0,0,.2);padding-top:calc(14px + env(safe-area-inset-top))}
  #side.open{transform:none}
  #scrim.open{display:block;position:fixed;inset:0;z-index:19;background:rgba(0,0,0,.35)}
}

.notice{margin:12px 16px 0;padding:10px 12px;border-radius:10px;background:var(--soft);color:var(--warn);font-size:13px}
#pane > .notice{width:auto;max-width:728px}

/* Chat */
#chat{flex:1;display:flex;flex-direction:column;min-height:0}
#log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:88%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.user{align-self:flex-end;background:var(--user);color:var(--user-ink);border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:4px}
.msg.thinking{color:var(--muted);font-style:italic}
.empty{margin:auto;text-align:center;color:var(--muted);max-width:420px;padding:24px 8px}
.empty h2{color:var(--ink);font-size:22px;margin-bottom:8px}
.suggest{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}
.suggest button{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:14px;color:var(--ink)}

.card{align-self:stretch;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:14px}
.card h3{margin:0 0 8px;font-size:16px}
.card ul{margin:0 0 10px;padding-left:18px;color:var(--ink);font-size:14px}
.card li{margin:2px 0;overflow-wrap:anywhere}
.card .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.state{font-size:13px;font-weight:600}
.state.applied{color:var(--ok)} .state.failed,.state.expired,.state.cancelled{color:var(--bad)} .state.confirmed,.state.running{color:var(--warn)}
.card.applied{border-left-color:var(--ok)} .card.failed{border-left-color:var(--bad)} .card.cancelled,.card.expired{border-left-color:var(--line);opacity:.8}
.card .err{color:var(--bad);font-size:13px;margin-top:6px}
/* Vista previa a pantalla completa (03/10/2026) */
#pvModal{position:fixed;inset:0;z-index:50;background:rgba(12,14,18,.94);display:flex;flex-direction:column;color:#f3eee4}
#pvModal.hidden{display:none}
.pvm-head{display:flex;align-items:center;gap:10px;padding:10px 12px 6px 16px}
.pvm-head h2{font-size:16px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pvm-close{flex:none;background:none;border:0;color:inherit;width:44px;height:44px;border-radius:10px;font-size:28px;line-height:1}
.pvm-close:hover{background:rgba(255,255,255,.08)}
.pvm-close:focus-visible,.pvm-tabs button:focus-visible,.pvm-ad:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pvm-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;padding:0 12px 10px}
.pvm-ad{font:inherit;font-size:14px;color:#1a1f25;background:#f3eee4;border:0;border-radius:10px;padding:8px 10px;max-width:100%}
.pvm-tabs{display:inline-flex;background:rgba(255,255,255,.1);border-radius:999px;padding:3px;gap:2px}
.pvm-tabs button{background:none;border:0;border-radius:999px;padding:8px 16px;font-size:15px;color:#cfc8ba}
.pvm-tabs button[aria-selected=true]{background:#f3eee4;color:#1a1f25;font-weight:600}
.pvm-tabs button:disabled{opacity:.45}
.pvm-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px 10px}
.pvm-fit{position:relative;flex:none}
.pvm-fit iframe{position:absolute;top:0;left:0;border:0;background:#fff;border-radius:10px;transform-origin:top left}
.pvm-msg{color:#cfc8ba;text-align:center;padding:24px;font-size:15px;max-width:440px}
.pvm-msg.err{color:#f0a49b}
.pvm-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;padding:10px 14px calc(12px + env(safe-area-inset-bottom))}
.pvm-foot .ghost{color:#f3eee4;border-color:rgba(255,255,255,.35)}
.pvm-foot .note{margin:0;width:100%;color:#a9a194;font-size:13px;text-align:center}
.pvm-foot .err{width:100%;color:#f0a49b;font-size:14px;text-align:center}
.pvm-foot label{display:flex;align-items:center;gap:8px;color:#cfc8ba;font-size:14px}
.pvm-foot input[type=range]{width:min(240px,50vw);accent-color:var(--accent)}
.crop-area{position:relative;flex:none;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden;border-radius:6px}
.crop-area img{display:block;width:100%;height:100%;pointer-events:none}
.crop-box{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.6);cursor:move;touch-action:none}
.crop-box::before,.crop-box::after{content:"";position:absolute;inset:0;pointer-events:none;border:0 solid rgba(255,255,255,.35)}
.crop-box::before{left:33.33%;right:33.33%;border-left-width:1px;border-right-width:1px}
.crop-box::after{top:33.33%;bottom:33.33%;border-top-width:1px;border-bottom-width:1px}

#compose{border-top:1px solid var(--line);padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--bg)}
/* Anuncios en preparación: cada uno con SU material */
#drafts{border-bottom:1px solid var(--line);padding:10px 12px;background:var(--bg)}
#drafts .head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
#drafts .head b{font-size:14px}
#drafts .head span{font-size:12px;color:var(--muted)}
#draftList{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}
#draftList:empty{display:none}
.draft{flex:none;width:210px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}
.draft .top{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px}
.draft .top b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.draft .x{background:none;border:0;color:var(--muted);font-size:18px;line-height:1;padding:2px 4px}
.files{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.file{position:relative;width:56px;height:56px;border-radius:8px;overflow:hidden;border:1px solid var(--line);background:var(--soft)}
.file img,.file video{width:100%;height:100%;object-fit:cover;display:block}
.file .tag{position:absolute;left:3px;bottom:3px;font-size:9px;background:rgba(0,0,0,.6);color:#fff;border-radius:4px;padding:0 4px}
.file .rm{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:18px;padding:0}
.upload{width:100%;font-size:13px;padding:8px}
.progress{font-size:12px;color:var(--muted);margin-top:6px}
.newdraft{background:var(--panel);border:1px dashed var(--accent);color:var(--accent);border-radius:10px;padding:7px 12px;font-size:14px;font-weight:600;white-space:nowrap}
#form{display:flex;gap:8px;align-items:flex-end}
#text{resize:none;min-height:44px;max-height:160px}
#send{flex:none;height:44px}

/* Conocimiento */
#knowledge{flex:1;overflow-y:auto;padding:20px 16px;display:flex;flex-direction:column;gap:12px}
#knowledge h2{font-size:22px}
#knowledge p{margin:0;color:var(--muted);font-size:14px}
#kText{min-height:320px;flex:1;resize:vertical;line-height:1.55}
#knowledge .row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#kCount{font-size:12px;color:var(--muted)}
#kStatus{font-size:13px;color:var(--muted);flex:1}
#kStatus.dirty{color:var(--warn)} #kStatus.saved{color:var(--ok)} #kStatus.bad{color:var(--bad)}

/* Contactos */
#leads{flex:1;overflow-y:auto;padding:20px 16px}
#leads h2{font-size:22px;margin:0 0 6px}
#leads > p{margin:0 0 14px;color:var(--muted);font-size:14px}
.lead{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.lead .top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}
.lead h3{margin:0;font-size:15px;overflow-wrap:anywhere}
.lead .when{font-size:12px;color:var(--muted)}
.lead dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0;font-size:14px}
.lead dt{color:var(--muted)} .lead dd{margin:0;overflow-wrap:anywhere}
.lead a{color:var(--accent)}

/* Resultados */
#results{flex:1;overflow-y:auto;padding:16px}
.range{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.range button{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:14px;color:var(--ink)}
.range button[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px}
@media (min-width:560px){.tiles{grid-template-columns:repeat(4,1fr)}}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums;font-family:Georgia,serif}
.tile span{font-size:13px;color:var(--muted)}
.section{margin:18px 0 8px;font-size:17px}
.bars{display:flex;align-items:flex-end;gap:3px;height:90px;padding:8px 0;border-bottom:1px solid var(--line)}
.bars div{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;position:relative}
.bars div.buy::after{content:"";position:absolute;top:-8px;left:50%;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:var(--ok)}
.barlabels{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px}
.legend{font-size:12px;color:var(--muted);margin-top:6px}
.camp{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.camp .top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.camp h3{margin:0;font-size:15px;overflow-wrap:anywhere}
.pill{font-size:12px;border-radius:999px;padding:2px 8px;background:var(--soft);color:var(--muted);white-space:nowrap}
.pill.on{color:var(--ok)} .pill.bad{color:var(--bad)}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;font-size:13px;color:var(--muted)}
.nums b{display:block;color:var(--ink);font-size:15px;font-variant-numeric:tabular-nums}
.muted{color:var(--muted);font-size:14px}
</style>
</head>
<body>

<section id="login" class="hidden">
  <form id="loginForm" autocomplete="on">
    <h1>{{PANEL_TITLE}}</h1>
    <p>Tus campañas de Instagram, desde aquí.</p>
    <label>Usuario <input type="text" name="user" autocomplete="username" required></label>
    <label>Contraseña
      <span class="pass">
        <input type="password" name="password" id="password" autocomplete="current-password" required>
        <button type="button" id="eye" aria-label="Mostrar contraseña" aria-pressed="false">
          <svg id="eyeOpen" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg id="eyeShut" class="hidden" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
      </span>
    </label>
    <label id="codeRow" class="hidden">Código de tu app de autenticación
      <input type="text" name="code" id="loginCode" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*">
    </label>
    <div class="error" id="loginError"></div>
    <button class="primary" type="submit">Entrar</button>
  </form>
</section>

<section id="twofa" class="hidden">
  <form id="twofaForm">
    <h1>Activa la verificación en dos pasos</h1>
    <p class="muted">Desde ahora, para entrar al panel hace falta la contraseña y un código que cambia cada 30 segundos en tu móvil. Así nadie puede entrar aunque sepa la contraseña.</p>
    <ol>
      <li>Instala en tu móvil una app de autenticación: <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> (gratis).</li>
      <li>En la app, añade una cuenta y escanea este código. Si estás en el móvil, toca «Abrir en la app».</li>
    </ol>
    <div class="qr"><img id="twofaQr" alt="Código QR para la app de autenticación"></div>
    <a class="ghost" id="twofaLink" href="#" style="text-align:center;text-decoration:none">Abrir en la app</a>
    <p class="muted">¿No puedes escanear? Escribe esta clave en la app:</p>
    <code id="twofaSecret"></code>
    <label>Escribe el código de 6 cifras que muestra la app
      <input type="text" id="twofaCode" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" required>
    </label>
    <div class="error" id="twofaError"></div>
    <button class="primary" type="submit">Activar y entrar</button>
    <button class="ghost" type="button" id="twofaOut">Salir</button>
  </form>
</section>

<section id="app" class="hidden">
  <header>
    <button id="menu" type="button" aria-label="Abrir el menú" aria-expanded="false" aria-controls="side">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
    </button>
    <h1>{{PANEL_TITLE}}</h1>
    <button id="logout" title="Salir">Salir</button>
  </header>
  <div id="body">
  <nav id="side" aria-label="Secciones">
    <div class="nav">
      <button type="button" data-view="chat" aria-current="page">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Crear campañas</button>
      <button type="button" data-view="results">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="9"/></svg>
        Resultados</button>
      <button type="button" data-view="leads">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Contactos</button>
      <button type="button" data-view="knowledge">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>
        Conocimiento</button>
    </div>
    <div id="chatsBox">
      <div class="head"><b>Conversaciones</b><button type="button" class="newdraft" id="newChat">+ Nueva</button></div>
      <ul id="chatList"></ul>
      <div id="sideError" role="alert"></div>
    </div>
  </nav>
  <div id="scrim"></div>
  <main id="pane">
  <div id="notice" class="notice hidden"></div>

  <div id="chat">
    <section id="drafts">
      <div class="head"><div><b>Anuncios en preparación</b><br><span>Sube a cada anuncio sus fotos o vídeos</span></div><button type="button" class="newdraft" id="newDraft">+ Nuevo anuncio</button></div>
      <div id="draftList"></div>
    </section>
    <div id="log"></div>
    <div id="compose">
      <input type="file" id="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple class="hidden">
      <form id="form">
        <textarea id="text" rows="1" placeholder="¿Qué quieres hacer?"></textarea>
        <button class="primary" id="send" type="submit">Enviar</button>
      </form>
    </div>
  </div>

  <div id="results" class="hidden">
    <div class="range">
      <button data-days="1">Hoy</button>
      <button data-days="7" aria-pressed="true">7 días</button>
      <button data-days="30">30 días</button>
    </div>
    <div id="resultsBody" class="muted">Cargando…</div>
  </div>

  <div id="leads" class="hidden">
    <h2>Contactos</h2>
    <p>La gente que dejó sus datos en el formulario de un anuncio. Cada contacto nuevo te llega también por correo.</p>
    <div id="leadsBody" class="muted">Cargando…</div>
  </div>

  <div id="knowledge" class="hidden">
    <h2>Conocimiento de la marca</h2>
    <p>Cuéntale aquí al asistente cómo es tu negocio. Lo lee cada vez que te ayuda, y con esto escribe los textos de los anuncios y elige a quién mostrarlos.</p>
    <textarea id="kText" maxlength="8000" aria-label="Conocimiento de la marca" placeholder="Por ejemplo:&#10;&#10;Qué vendo: …&#10;Precios: …&#10;Dónde se compra: la web, una tienda física…&#10;A quién le vendo: …&#10;Cómo quiero hablar en los anuncios: cercano, de tú, sin exagerar…&#10;Palabras que sí y que no:…&#10;Qué me diferencia:…"></textarea>
    <div class="row"><span id="kCount"></span><span id="kStatus"></span><button class="primary" type="button" id="kSave">Guardar</button></div>
  </div>
  </main>
  </div>
</section>

<div id="pvModal" class="hidden" role="dialog" aria-modal="true" aria-labelledby="pvTitle">
  <div class="pvm-head"><h2 id="pvTitle">Cómo queda el anuncio</h2><button type="button" class="pvm-close" id="pvClose" aria-label="Cerrar la vista previa">×</button></div>
  <div class="pvm-bar">
    <select id="pvAd" class="pvm-ad hidden" aria-label="Qué anuncio ver"></select>
    <div class="pvm-tabs" role="tablist" id="pvTabs" aria-label="Dónde sale">
      <button type="button" role="tab" data-f="feed">Feed</button><button type="button" role="tab" data-f="story">Historias</button><button type="button" role="tab" data-f="reels">Reels</button>
    </div>
  </div>
  <div class="pvm-stage" id="pvStage"></div>
  <div class="pvm-foot" id="pvFoot"></div>
</div>
<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var log = $("log");
  var polling = {};
  var busy = false;

  function el(tag, cls, text){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function api(path, opts){
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
    if (opts.json !== undefined){ init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.json); }
    if (opts.form){ init.body = opts.form; }
    if (opts.raw){ init.headers["Content-Type"] = "application/octet-stream"; init.body = opts.raw; }
    return fetch(path, init).then(function(r){
      if (r.status === 401 && path !== "api/login"){ showLogin(); throw new Error("sesión"); }
      if (r.status === 403){ return r.json().then(function(d){ if (d.setup2fa){ showTwoFactor(); throw new Error("dos pasos"); } throw new Error(d.error || "Error 403"); }); }
      return r.json().then(function(d){ if (!r.ok) throw new Error(d.error || ("Error " + r.status)); return d; });
    });
  }
  function eur(n){ return n === null || n === undefined ? "—" : n.toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:2}); }
  function num(n){ return (n || 0).toLocaleString("es-ES"); }

  function showLogin(){ $("app").classList.add("hidden"); $("twofa").classList.add("hidden"); $("login").classList.remove("hidden"); }
  function showApp(){ $("login").classList.add("hidden"); $("twofa").classList.add("hidden"); $("app").classList.remove("hidden"); }
  var twofaShown = false;
  function showTwoFactor(){
    $("login").classList.add("hidden"); $("app").classList.add("hidden"); $("twofa").classList.remove("hidden");
    if (twofaShown) return;
    twofaShown = true;
    api("api/2fa/setup").then(function(d){
      $("twofaQr").src = d.qr; $("twofaLink").href = d.uri; $("twofaSecret").textContent = d.secret;
      $("twofaCode").focus();
    }).catch(function(err){ twofaShown = false; $("twofaError").textContent = err.message; });
  }
  $("twofaForm").addEventListener("submit", function(e){
    e.preventDefault();
    $("twofaError").textContent = "";
    api("api/2fa/enable", { method:"POST", json:{ code:$("twofaCode").value } })
      .then(function(){ $("twofaCode").value = ""; boot(); })
      .catch(function(err){ $("twofaError").textContent = err.message; });
  });
  $("twofaOut").addEventListener("click", function(){ api("api/logout",{method:"POST"}).finally(function(){ twofaShown = false; showLogin(); }); });

  $("loginForm").addEventListener("submit", function(e){
    e.preventDefault();
    var f = e.target;
    $("loginError").textContent = "";
    var body = { user:f.user.value, password:f.password.value };
    if (!$("codeRow").classList.contains("hidden")) body.code = f.code.value;
    fetch("api/login", { method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"same-origin", body:JSON.stringify(body) })
      .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
      .then(function(x){
        if (x.d.need2fa){
          // La contraseña estaba bien: falta el código de la app.
          // La primera vez sólo aparece el campo; el aviso, si el código estaba mal.
          var wrong = !$("codeRow").classList.contains("hidden");
          $("codeRow").classList.remove("hidden"); f.code.value = ""; f.code.focus();
          $("loginError").textContent = wrong ? (x.d.error || "") : "";
          return;
        }
        if (!x.ok) throw new Error(x.d.error || "No se pudo entrar.");
        f.password.value = ""; f.code.value = ""; $("codeRow").classList.add("hidden");
        if (f.password.type === "text") $("eye").click();
        boot();
      })
      .catch(function(err){ $("loginError").textContent = err.message; });
  });
  $("eye").addEventListener("click", function(){
    var input = $("password"), show = input.type === "password";
    input.type = show ? "text" : "password";
    this.setAttribute("aria-pressed", show ? "true" : "false");
    this.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    $("eyeOpen").classList.toggle("hidden", show);
    $("eyeShut").classList.toggle("hidden", !show);
  });
  $("logout").addEventListener("click", function(){ api("api/logout",{method:"POST"}).finally(showLogin); });

  // Menú de la izquierda (en el móvil, un cajón que se abre con el botón)
  var view = "chat";
  function openMenu(open){
    $("side").classList.toggle("open", open); $("scrim").classList.toggle("open", open);
    $("menu").setAttribute("aria-expanded", open ? "true" : "false");
  }
  $("menu").addEventListener("click", function(){ openMenu(!$("side").classList.contains("open")); });
  $("scrim").addEventListener("click", function(){ openMenu(false); });
  function showView(v){
    if (v !== "knowledge" && view === "knowledge" && kDirty && !confirm("Tienes cambios sin guardar en Conocimiento. ¿Salir sin guardar?")) return false;
    view = v;
    Array.prototype.forEach.call(document.querySelectorAll(".nav button"), function(x){
      if (x.dataset.view === v) x.setAttribute("aria-current","page"); else x.removeAttribute("aria-current");
    });
    $("chat").classList.toggle("hidden", v !== "chat");
    $("results").classList.toggle("hidden", v !== "results");
    $("knowledge").classList.toggle("hidden", v !== "knowledge");
    $("leads").classList.toggle("hidden", v !== "leads");
    if (v === "results") loadResults(currentDays);
    if (v === "leads") loadLeads();
    if (v === "knowledge") loadKnowledge();
    openMenu(false);
    return true;
  }
  Array.prototype.forEach.call(document.querySelectorAll(".nav button"), function(b){
    b.addEventListener("click", function(){ showView(b.dataset.view); });
  });

  // Conversaciones
  var currentChat = null;
  try { currentChat = Number(localStorage.getItem("adsChat")) || null; } catch (e) { currentChat = null; }
  function rememberChat(id){ currentChat = id; try { localStorage.setItem("adsChat", String(id)); } catch (e) { /* sin almacenamiento: da igual */ } }
  var TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
  var PENCIL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  function renderChats(list){
    var ul = $("chatList"); ul.textContent = "";
    list.forEach(function(c){
      var li = el("li", c.id === currentChat ? "active" : null);
      var pick = el("button","pick",c.title); pick.type = "button"; pick.title = c.title;
      if (c.id === currentChat) pick.setAttribute("aria-current","true");
      pick.addEventListener("click", function(){
        if (busy) return;
        if (!showView("chat")) return;
        if (c.id !== currentChat){ rememberChat(c.id); boot(); }
      });
      var del = el("button","del"); del.type = "button"; del.innerHTML = TRASH;
      del.setAttribute("aria-label","Eliminar «" + c.title + "»"); del.title = "Eliminar conversación";
      del.addEventListener("click", function(){
        if (busy) return;
        if (!confirm("¿Eliminar «" + c.title + "»?\\n\\nSe borran sus mensajes y el material que subiste en ella. Lo que ya está en Meta no cambia.")) return;
        $("sideError").textContent = "";
        api("api/chats/" + c.id + "/delete",{method:"POST"}).then(function(){
          if (c.id === currentChat) currentChat = null;
          boot();
        }).catch(function(err){ $("sideError").textContent = err.message; });
      });
      var ren = el("button","del"); ren.type = "button"; ren.innerHTML = PENCIL;
      ren.setAttribute("aria-label","Cambiar el nombre de «" + c.title + "»"); ren.title = "Cambiar el nombre";
      ren.addEventListener("click", function(){
        if (busy) return;
        var input = el("input","rename"); input.type = "text"; input.value = c.title; input.maxLength = 80;
        input.setAttribute("aria-label","Nombre de la conversación");
        li.replaceChild(input, pick); ren.hidden = true; del.hidden = true;
        input.focus(); input.select();
        var done = false;
        function finish(save){
          if (done) return; done = true;
          var title = input.value.trim();
          if (!save || !title || title === c.title){ renderChats(list); return; }
          api("api/chats/" + c.id + "/rename",{method:"POST",json:{title:title}}).then(function(){ refreshChats(); })
            .catch(function(err){ $("sideError").textContent = err.message; renderChats(list); });
        }
        input.addEventListener("keydown", function(e){
          if (e.key === "Enter"){ e.preventDefault(); finish(true); }
          if (e.key === "Escape"){ e.preventDefault(); finish(false); }
        });
        input.addEventListener("blur", function(){ finish(true); });
      });
      li.appendChild(pick); li.appendChild(ren); li.appendChild(del); ul.appendChild(li);
    });
  }
  function refreshChats(){ api("api/chats").then(renderChats).catch(function(){}); }
  $("newChat").addEventListener("click", function(){
    if (busy) return;
    $("sideError").textContent = "";
    api("api/chats",{method:"POST"}).then(function(c){ rememberChat(c.id); showView("chat"); boot(); })
      .catch(function(err){ $("sideError").textContent = err.message; });
  });

  // Conocimiento
  var kDirty = false, kLoaded = false, kMax = 8000;
  function kCount(){ $("kCount").textContent = $("kText").value.length.toLocaleString("es-ES") + " / " + kMax.toLocaleString("es-ES"); }
  function kState(text, cls){ var s = $("kStatus"); s.textContent = text; s.className = cls || ""; }
  function loadKnowledge(){
    if (kDirty) return;
    // Mientras carga no se puede escribir: si no, lo guardado pisaría lo que se esté tecleando.
    $("kText").readOnly = true;
    kState("Cargando…");
    api("api/knowledge").then(function(k){
      kMax = k.max || kMax; $("kText").maxLength = kMax;
      $("kText").value = k.content || ""; kLoaded = true; kCount();
      kState(k.content ? "Guardado" : "Todavía no hay nada escrito", k.content ? "saved" : "");
    }).catch(function(err){ kState(err.message, "bad"); })
      .finally(function(){ $("kText").readOnly = false; });
  }
  $("kText").addEventListener("input", function(){ kDirty = true; kCount(); kState("Cambios sin guardar", "dirty"); });
  $("kSave").addEventListener("click", function(){
    if (!kLoaded) return;
    var b = $("kSave"); b.disabled = true; kState("Guardando…");
    api("api/knowledge",{method:"PUT",json:{content:$("kText").value}}).then(function(k){
      $("kText").value = k.content; kDirty = false; kCount(); kState("Guardado. El asistente ya lo tiene en cuenta.", "saved");
    }).catch(function(err){ kState("No se pudo guardar: " + err.message, "bad"); }).finally(function(){ b.disabled = false; });
  });
  window.addEventListener("beforeunload", function(e){ if (kDirty){ e.preventDefault(); e.returnValue = ""; } });

  // Chat
  var STATE = { proposed:"Esperando tu confirmación", confirmed:"Confirmado, aplicándose…", running:"Aplicándose en Meta…", applied:"Hecho en Meta ✓", failed:"No se pudo aplicar", cancelled:"Cancelado", expired:"Caducó sin confirmar" };

  function renderEmpty(){
    var box = el("div","empty");
    box.appendChild(el("h2",null,"¿Qué hacemos hoy?"));
    box.appendChild(el("p",null,"Te guío paso a paso para crear y mejorar tus anuncios de Instagram. Nada cambia hasta que tú lo confirmes."));
    var s = el("div","suggest");
    ["Quiero crear mi primer anuncio","¿Cómo fueron los anuncios esta semana?","¿Qué anuncio vende más?"].forEach(function(t){
      var b = el("button",null,t); b.type = "button";
      b.addEventListener("click", function(){ $("text").value = t; $("text").focus(); });
      s.appendChild(b);
    });
    box.appendChild(s);
    log.appendChild(box);
  }
  function addMsg(role, text){
    var empty = log.querySelector(".empty"); if (empty) empty.remove();
    var m = el("div","msg " + role, text);
    log.appendChild(m); log.scrollTop = log.scrollHeight;
    return m;
  }
  function renderCard(c, node){
    var card = node || el("div");
    card.className = "card " + c.state;
    card.dataset.code = c.code;
    card.textContent = "";
    card.appendChild(el("h3",null,c.title));
    var ul = el("ul");
    c.lines.forEach(function(l){ ul.appendChild(el("li",null,l)); });
    card.appendChild(ul);
    var row = el("div","row");
    if (c.state === "proposed"){
      var ok = el("button","primary","Confirmar"); ok.type = "button";
      var no = el("button","ghost","Cancelar"); no.type = "button";
      ok.addEventListener("click", function(){ ok.disabled = no.disabled = true; act(c.code,"confirm",card); });
      no.addEventListener("click", function(){ ok.disabled = no.disabled = true; act(c.code,"cancel",card); });
      row.appendChild(ok); row.appendChild(no);
    } else {
      row.appendChild(el("span","state " + c.state, STATE[c.state] || c.state));
    }
    if (c.previews && c.previews.length){
      var see = el("button","ghost see","Ver cómo queda"); see.type = "button";
      see.addEventListener("click", function(){ pvOpen(c, card, see); });
      row.appendChild(see);
    }
    card.appendChild(row);
    if (c.error) card.appendChild(el("div","err",c.error));
    if (!node){ var empty = log.querySelector(".empty"); if (empty) empty.remove(); log.appendChild(card); log.scrollTop = log.scrollHeight; }
    if ((c.state === "confirmed" || c.state === "running") && !polling[c.code]) poll(c.code, card);
    return card;
  }
  // Vista previa a pantalla completa (03/10/2026): el anuncio tal como
  // lo dibuja Meta en cada sitio de Instagram, con la opción de recortar la
  // foto para ese sitio. Mientras el material se sube o se procesa, vuelve a
  // preguntar sola cada 5 segundos.
  var PLACE = { feed:"Feed", story:"Historias", reels:"Reels" };
  // Las formas de cada sitio: el Feed admite vertical 4:5 y cuadrada.
  var ASPECTS = { feed:[[4,5,"Vertical 4:5"],[1,1,"Cuadrada"]], story:[[9,16,"9:16"]], reels:[[9,16,"9:16"]] };
  var pv = { card:null, node:null, opener:null, ad:0, fmt:"feed", seq:0, timer:null, last:null, frame:null, crop:null };
  var pvModal = $("pvModal"), pvStage = $("pvStage"), pvFoot = $("pvFoot"), pvAd = $("pvAd");
  function pvOpen(c, node, opener){
    pv.card = c; pv.node = node; pv.opener = opener; pv.ad = 0; pv.fmt = "feed"; pv.crop = null;
    pvAd.textContent = "";
    c.previews.forEach(function(l, i){ var o = el("option",null,(i + 1) + ". " + l); o.value = String(i); pvAd.appendChild(o); });
    pvAd.classList.toggle("hidden", c.previews.length < 2);
    $("pvTitle").textContent = c.title;
    pvModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    pvTabs();
    pvLoad(0);
    $("pvClose").focus();
  }
  function pvClose(){
    pvModal.classList.add("hidden");
    clearTimeout(pv.timer); pv.seq++; pv.crop = null; pv.frame = null;
    pvStage.textContent = ""; pvFoot.textContent = "";
    document.body.style.overflow = "";
    // La tarjeta pudo repintarse (un recorte cambia sus líneas): el foco vuelve a su botón.
    var see = pv.node && pv.node.querySelector(".see");
    if (see) see.focus(); else if (pv.opener) pv.opener.focus();
  }
  function pvTabs(){
    Array.prototype.forEach.call($("pvTabs").children, function(b){
      b.setAttribute("aria-selected", b.dataset.f === pv.fmt ? "true" : "false");
      b.disabled = Boolean(pv.crop);
    });
    pvAd.disabled = Boolean(pv.crop);
  }
  function pvMsg(text, bad){ pvStage.textContent = ""; pv.frame = null; pvStage.appendChild(el("div","pvm-msg" + (bad ? " err" : ""), text)); }
  function pvLoad(tries){
    var my = ++pv.seq; clearTimeout(pv.timer);
    if (!tries){ pvMsg("Pidiendo la vista previa a Meta…"); pvFoot.textContent = ""; }
    api("api/actions/" + pv.card.code + "/preview?ad=" + pv.ad + "&format=" + pv.fmt).then(function(r){
      if (my !== pv.seq || pv.crop) return;
      pv.last = r;
      if (r.src){ pvFrame(r); }
      else if (r.wait){
        pvMsg(r.wait);
        if (tries < 60) pv.timer = setTimeout(function(){ if (!pvModal.classList.contains("hidden")) pvLoad(tries + 1); }, 5000);
        else pvMsg("Sigue sin estar listo. Vuelve a abrir la vista previa en un rato.", true);
      } else { pvMsg(r.error || "No se pudo cargar la vista previa.", true); }
      pvFootFor(r.crop);
    }).catch(function(err){ if (my === pv.seq){ pvMsg(err.message, true); pvFoot.textContent = ""; } });
  }
  function pvFrame(r){
    pvStage.textContent = "";
    var box = el("div","pvm-fit");
    var f = document.createElement("iframe");
    f.src = r.src; f.width = r.width; f.height = r.height;
    f.title = "Vista previa del anuncio en " + PLACE[pv.fmt];
    f.setAttribute("sandbox","allow-scripts allow-same-origin allow-popups");
    f.setAttribute("allow","autoplay");
    box.appendChild(f); pvStage.appendChild(box);
    pv.frame = { w:r.width, h:r.height, box:box, f:f };
    pvFit();
  }
  // El recuadro de Meta mide unos 320 px: se agranda hasta llenar la pantalla.
  function pvFit(){
    if (!pv.frame) return;
    var s = Math.min((pvStage.clientWidth - 8) / pv.frame.w, (pvStage.clientHeight - 8) / pv.frame.h, 3);
    if (!(s > 0)) s = 1;
    pv.frame.box.style.width = Math.round(pv.frame.w * s) + "px";
    pv.frame.box.style.height = Math.round(pv.frame.h * s) + "px";
    pv.frame.f.style.transform = "scale(" + s + ")";
  }
  function pvFootFor(crop){
    pvFoot.textContent = "";
    if (!crop) return;
    if (crop.allowed){
      var b = el("button","primary",(crop.current ? "Cambiar el recorte para " : "Recortar la foto para ") + PLACE[pv.fmt]); b.type = "button";
      b.addEventListener("click", function(){ cropStart(crop); });
      pvFoot.appendChild(b);
      if (crop.current){
        var o = el("button","ghost","Volver a la foto original"); o.type = "button";
        o.addEventListener("click", function(){ o.disabled = b.disabled = true; cropSave(null); });
        pvFoot.appendChild(o);
      }
      pvFoot.appendChild(el("p","note", crop.current ? "En " + PLACE[pv.fmt] + " sale tu recorte. Lo que ves es lo que se publica." : "Meta recorta la foto solo para cada sitio. Si aquí no queda bien, recórtala tú: se publica tal cual."));
    } else if (crop.reason){
      pvFoot.appendChild(el("p","note",crop.reason));
    }
  }
  // El editor de recorte: un marco con la forma del sitio que se mueve
  // arrastrando y se agranda con la barra. Trabaja en píxeles de la foto
  // original; el recorte se guarda como un JPG nuevo que cuelga de ella.
  function cropStart(crop){
    pv.seq++; clearTimeout(pv.timer);
    pv.crop = { original:crop.original, aspect:ASPECTS[pv.fmt][0], size:1, cx:0.5, cy:0.5, img:null, place:null };
    pvTabs();
    pvMsg("Cargando la foto…"); pvFoot.textContent = "";
    var img = new Image();
    img.onload = function(){ if (pv.crop){ pv.crop.img = img; cropDraw(); cropFoot(); } };
    img.onerror = function(){ pvMsg("No se pudo cargar la foto.", true); };
    img.src = "api/media/" + crop.original;
  }
  function cropRect(){
    var c = pv.crop, W = c.img.naturalWidth, H = c.img.naturalHeight;
    var a = c.aspect[0] / c.aspect[1];
    var w = Math.min(W, H * a) * c.size, h = w / a;
    var x = Math.min(Math.max(c.cx * W - w / 2, 0), W - w), y = Math.min(Math.max(c.cy * H - h / 2, 0), H - h);
    c.cx = (x + w / 2) / W; c.cy = (y + h / 2) / H;
    return { x:x, y:y, w:w, h:h };
  }
  function cropDraw(){
    var c = pv.crop; if (!c || !c.img) return;
    pvStage.textContent = ""; pv.frame = null;
    var W = c.img.naturalWidth, H = c.img.naturalHeight;
    var k = Math.min((pvStage.clientWidth - 8) / W, (pvStage.clientHeight - 8) / H);
    var area = el("div","crop-area");
    area.style.width = Math.round(W * k) + "px"; area.style.height = Math.round(H * k) + "px";
    var shown = c.img.cloneNode(); shown.alt = "La foto del anuncio"; area.appendChild(shown);
    var box = el("div","crop-box"); box.setAttribute("aria-label","Zona que se publica en " + PLACE[pv.fmt]); area.appendChild(box);
    function place(){ var r = cropRect(); box.style.left = r.x * k + "px"; box.style.top = r.y * k + "px"; box.style.width = r.w * k + "px"; box.style.height = r.h * k + "px"; }
    place();
    var drag = null;
    box.addEventListener("pointerdown", function(e){ drag = { x:e.clientX, y:e.clientY, cx:c.cx, cy:c.cy }; box.setPointerCapture(e.pointerId); e.preventDefault(); });
    box.addEventListener("pointermove", function(e){
      if (!drag) return;
      c.cx = drag.cx + (e.clientX - drag.x) / (W * k); c.cy = drag.cy + (e.clientY - drag.y) / (H * k);
      place();
    });
    box.addEventListener("pointerup", function(){ drag = null; });
    box.addEventListener("pointercancel", function(){ drag = null; });
    c.place = place;
    pvStage.appendChild(area);
  }
  function cropFoot(){
    var c = pv.crop; pvFoot.textContent = "";
    var aspects = ASPECTS[pv.fmt];
    if (aspects.length > 1){
      var tabs = el("div","pvm-tabs"); tabs.setAttribute("role","group"); tabs.setAttribute("aria-label","Forma del recorte");
      aspects.forEach(function(a){
        var b = el("button",null,a[2]); b.type = "button";
        b.setAttribute("aria-pressed", c.aspect === a ? "true" : "false");
        b.setAttribute("aria-selected", c.aspect === a ? "true" : "false");
        b.addEventListener("click", function(){ c.aspect = a; cropDraw(); cropFoot(); });
        tabs.appendChild(b);
      });
      pvFoot.appendChild(tabs);
    }
    var lab = el("label",null,"Tamaño");
    var range = document.createElement("input"); range.type = "range"; range.min = "30"; range.max = "100"; range.value = String(Math.round(c.size * 100));
    range.addEventListener("input", function(){ c.size = Number(range.value) / 100; if (c.place) c.place(); });
    lab.appendChild(range); pvFoot.appendChild(lab);
    var save = el("button","primary","Guardar recorte"); save.type = "button";
    var back = el("button","ghost","Cancelar"); back.type = "button";
    save.addEventListener("click", function(){ save.disabled = back.disabled = true; save.textContent = "Guardando…"; cropUpload(); });
    back.addEventListener("click", function(){ pv.crop = null; pvTabs(); pvLoad(0); });
    pvFoot.appendChild(save); pvFoot.appendChild(back);
    pvFoot.appendChild(el("p","note","Arrastra el marco para elegir qué parte de la foto sale en " + PLACE[pv.fmt] + "."));
  }
  function cropFail(msg){
    pvFoot.querySelectorAll("button").forEach(function(b){ b.disabled = false; });
    var s = pvFoot.querySelector(".primary"); if (s) s.textContent = "Guardar recorte";
    var old = pvFoot.querySelector(".err"); if (old) old.remove();
    pvFoot.appendChild(el("div","err",msg));
  }
  function cropUpload(){
    var c = pv.crop, r = cropRect();
    var outW = Math.min(1080, Math.round(r.w)), outH = Math.round(outW * c.aspect[1] / c.aspect[0]);
    var canvas = document.createElement("canvas"); canvas.width = outW; canvas.height = outH;
    canvas.getContext("2d").drawImage(c.img, r.x, r.y, r.w, r.h, 0, 0, outW, outH);
    canvas.toBlob(function(blob){
      if (!blob){ cropFail("No se pudo preparar el recorte."); return; }
      api("api/media", { method:"POST", json:{ variantOf:c.original, name:"recorte-" + pv.fmt + ".jpg", type:"image/jpeg", size:blob.size, width:outW, height:outH } })
        .then(function(s){ return api("api/media/" + s.key + "/0", { method:"PUT", raw:blob }).then(function(){ return api("api/media/" + s.key + "/finish", { method:"POST" }); }); })
        .then(function(m){ cropSave(m.key); })
        .catch(function(err){ cropFail(err.message); });
    }, "image/jpeg", 0.92);
  }
  function cropSave(key){
    api("api/actions/" + pv.card.code + "/crop", { method:"POST", json:{ ad:pv.ad, placement:pv.fmt, key:key } }).then(function(c){
      pv.card = c;
      if (pv.node) renderCard(c, pv.node);
      pv.crop = null; pvTabs(); pvLoad(0);
    }).catch(function(err){ if (pv.crop) cropFail(err.message); else pvFoot.appendChild(el("div","err",err.message)); });
  }
  $("pvClose").addEventListener("click", pvClose);
  document.addEventListener("keydown", function(e){ if (e.key === "Escape" && !pvModal.classList.contains("hidden")) pvClose(); });
  Array.prototype.forEach.call($("pvTabs").children, function(b){
    b.addEventListener("click", function(){ if (pv.crop) return; pv.fmt = b.dataset.f; pvTabs(); pvLoad(0); });
  });
  pvAd.addEventListener("change", function(){ pv.ad = Number(pvAd.value); pvLoad(0); });
  window.addEventListener("resize", function(){ if (pv.crop && pv.crop.img) cropDraw(); else pvFit(); });
  function act(code, verb, card){
    api("api/actions/" + code + "/" + verb, { method:"POST" }).then(function(c){ renderCard(c, card); })
      .catch(function(err){ card.appendChild(el("div","err",err.message)); });
  }
  function poll(code, card){
    polling[code] = true;
    var tries = 0;
    (function tick(){
      setTimeout(function(){
        api("api/actions/" + code).then(function(c){
          renderCard(c, card);
          if ((c.state === "confirmed" || c.state === "running") && ++tries < 60) tick(); else delete polling[code];
        }).catch(function(){ delete polling[code]; });
      }, 4000);
    })();
  }

  function autosize(){ var t = $("text"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }
  $("text").addEventListener("input", autosize);
  $("text").addEventListener("keydown", function(e){ if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer:fine)").matches){ e.preventDefault(); $("form").requestSubmit(); } });

  $("form").addEventListener("submit", function(e){
    e.preventDefault();
    var text = $("text").value.trim();
    if (!text || busy) return;
    busy = true; $("send").disabled = true;
    addMsg("user", text);
    $("text").value = ""; autosize();
    var wait = addMsg("assistant thinking", "Mirando…");
    api("api/chat", { method:"POST", json:{ text:text, chatId:currentChat } }).then(function(d){
      wait.remove();
      addMsg("assistant", d.reply);
      d.cards.forEach(function(c){ renderCard(c); });
      refreshChats();
    }).catch(function(err){
      wait.textContent = err.message; wait.classList.remove("thinking");
    }).finally(function(){ busy = false; $("send").disabled = false; });
  });

  // Material por anuncio
  var uploadTarget = null;
  function fileTile(box, m){
    var t = el("div","file");
    if (m.kind === "video"){
      var v = document.createElement("video"); v.src = "api/media/" + m.key; v.muted = true; v.preload = "metadata"; v.playsInline = true;
      t.appendChild(v); t.appendChild(el("span","tag","vídeo"));
    } else {
      var i = new Image(); i.src = "api/media/" + m.key; i.alt = m.name; t.appendChild(i);
    }
    t.title = m.name + (m.mb ? " · " + m.mb + " MB" : "");
    var rm = el("button","rm","×"); rm.type = "button"; rm.setAttribute("aria-label","Quitar " + m.name);
    rm.addEventListener("click", function(){
      if (confirm("¿Quitar " + m.name + " de este anuncio?")) api("api/media/" + m.key + "/delete",{method:"POST"}).then(function(){ t.remove(); });
    });
    t.appendChild(rm);
    box.querySelector(".files").appendChild(t);
  }
  function renderDraft(d){
    var box = el("div","draft"); box.dataset.id = d.id;
    var top = el("div","top"); top.appendChild(el("b",null,d.label));
    var x = el("button","x","×"); x.type = "button"; x.title = "Quitar este anuncio de la lista";
    x.addEventListener("click", function(){
      if (confirm("¿Quitar «" + d.label + "» de los anuncios en preparación?")) api("api/drafts/" + d.id + "/archive",{method:"POST"}).then(function(){ box.remove(); });
    });
    top.appendChild(x); box.appendChild(top);
    box.appendChild(el("div","files"));
    var up = el("button","ghost upload","Subir foto o vídeo"); up.type = "button";
    up.addEventListener("click", function(){ uploadTarget = box; $("file").click(); });
    box.appendChild(up);
    var pr = el("div","progress"); pr.hidden = true; box.appendChild(pr);
    (d.media || []).forEach(function(m){ fileTile(box, m); });
    $("draftList").appendChild(box);
    return box;
  }
  $("newDraft").addEventListener("click", function(){
    api("api/drafts",{method:"POST",json:{chatId:currentChat}}).then(function(d){
      var box = renderDraft(d);
      box.scrollIntoView({behavior:"smooth",inline:"end",block:"nearest"});
    }).catch(function(err){ addMsg("assistant", err.message); });
  });
  function dims(file){
    return new Promise(function(res){
      var url = URL.createObjectURL(file);
      var isVideo = file.type.indexOf("video/") === 0;
      var node = isVideo ? document.createElement("video") : new Image();
      var done = function(w,h){ res({w:w,h:h}); URL.revokeObjectURL(url); };
      if (isVideo){ node.preload = "metadata"; node.onloadedmetadata = function(){ done(node.videoWidth,node.videoHeight); }; }
      else { node.onload = function(){ done(node.naturalWidth,node.naturalHeight); }; }
      node.onerror = function(){ done(0,0); };
      node.src = url;
    });
  }
  function uploadFile(box, f){
    var pr = box.querySelector(".progress");
    pr.hidden = false; pr.textContent = "Subiendo " + f.name + "…";
    return dims(f).then(function(d){
      return api("api/media",{method:"POST",json:{draftId:Number(box.dataset.id),name:f.name,type:f.type,size:f.size,width:d.w,height:d.h}});
    }).then(function(start){
      var n = 0;
      function next(){
        if (n >= start.chunks) return api("api/media/" + start.key + "/finish",{method:"POST"});
        var from = n * start.chunkSize;
        var part = f.slice(from, Math.min(f.size, from + start.chunkSize));
        pr.textContent = "Subiendo " + f.name + "… " + Math.round(from / f.size * 100) + "%";
        return api("api/media/" + start.key + "/" + n,{method:"PUT",raw:part}).then(function(){ n++; return next(); });
      }
      return next();
    }).then(function(m){
      fileTile(box, m); pr.hidden = true;
    }).catch(function(err){ pr.textContent = "No se pudo subir " + f.name + ": " + err.message; });
  }
  $("file").addEventListener("change", function(){
    var files = Array.prototype.slice.call($("file").files);
    $("file").value = "";
    var box = uploadTarget; if (!box) return;
    files.reduce(function(p, f){ return p.then(function(){ return uploadFile(box, f); }); }, Promise.resolve());
  });

  // Resultados
  var currentDays = 7;
  Array.prototype.forEach.call(document.querySelectorAll(".range button"), function(b){
    b.addEventListener("click", function(){
      Array.prototype.forEach.call(document.querySelectorAll(".range button"), function(x){ x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      currentDays = Number(b.dataset.days); loadResults(currentDays);
    });
  });
  function tile(parent, value, label){ var t = el("div","tile"); t.appendChild(el("b",null,value)); t.appendChild(el("span",null,label)); parent.appendChild(t); }
  var ESTADO = { ACTIVE:"Encendida", PAUSED:"Pausada", CAMPAIGN_PAUSED:"Pausada", ADSET_PAUSED:"Pausada", IN_PROCESS:"Procesando", WITH_ISSUES:"Con problemas", PENDING_REVIEW:"En revisión", DISAPPROVED:"Rechazada" };
  function loadResults(days){
    var body = $("resultsBody");
    body.className = "muted"; body.textContent = "Cargando…";
    api("api/overview?days=" + days).then(function(d){
      body.className = ""; body.textContent = "";
      var t = d.total || {};
      var tiles = el("div","tiles");
      tile(tiles, eur(t.gasto || 0), "gastado");
      tile(tiles, num(t.compras), "compras");
      tile(tiles, eur(t.coste_por_compra), "por compra");
      tile(tiles, eur(t.ingresos || 0), "vendido");
      body.appendChild(tiles);

      if (days > 1 && d.daily && d.daily.length){
        body.appendChild(el("h2","section","Gasto por día"));
        var max = Math.max.apply(null, d.daily.map(function(x){ return x.gasto; }).concat([0.01]));
        var bars = el("div","bars");
        d.daily.forEach(function(x){
          var b = el("div", x.compras > 0 ? "buy" : null);
          b.style.height = Math.max(2, Math.round(x.gasto / max * 100)) + "%";
          b.title = x.dia + ": " + eur(x.gasto) + ", " + x.compras + " compras";
          bars.appendChild(b);
        });
        body.appendChild(bars);
        var labels = el("div","barlabels");
        labels.appendChild(el("span",null,d.daily[0].dia.slice(5)));
        labels.appendChild(el("span",null,d.daily[d.daily.length-1].dia.slice(5)));
        body.appendChild(labels);
        body.appendChild(el("div","legend","El punto verde marca los días con alguna compra."));
      }

      body.appendChild(el("h2","section","Campañas"));
      if (!d.tree.length){ body.appendChild(el("p","muted","Todavía no hay campañas. Pídele al chat que te ayude a crear la primera.")); return; }
      d.tree.forEach(function(c){
        var m = d.campaigns.filter(function(x){ return x.id === c.id; })[0] || {};
        var box = el("div","camp");
        var top = el("div","top");
        top.appendChild(el("h3",null,c.nombre));
        var state = c.estado_real;
        top.appendChild(el("span","pill " + (state === "ACTIVE" ? "on" : (state === "DISAPPROVED" || state === "WITH_ISSUES") ? "bad" : ""), ESTADO[state] || state));
        box.appendChild(top);
        var budget = c.conjuntos.reduce(function(s, x){ return s + (x.presupuesto_diario_eur || 0); }, 0);
        box.appendChild(el("div","muted", eur(budget) + " al día · " + c.conjuntos.reduce(function(s,x){ return s + x.anuncios.length; },0) + " anuncios"));
        var n = el("div","nums");
        [[eur(m.gasto || 0),"gastado"],[num(m.compras),"compras"],[eur(m.coste_por_compra),"por compra"],[num(m.clics_enlace),"clics"],[(m.ctr || 0).toLocaleString("es-ES") + " %","CTR"],[m.roas === null || m.roas === undefined ? "—" : m.roas.toLocaleString("es-ES") + "×","retorno"]].forEach(function(p){
          var s = el("div"); s.appendChild(el("b",null,p[0])); s.appendChild(document.createTextNode(p[1])); n.appendChild(s);
        });
        box.appendChild(n);
        body.appendChild(box);
      });
    }).catch(function(err){ body.className = "muted"; body.textContent = err.message; });
  }

  // Contactos
  function loadLeads(){
    var body = $("leadsBody");
    body.className = "muted"; body.textContent = "Cargando…";
    api("api/leads").then(function(d){
      body.className = ""; body.textContent = "";
      var broken = (d.forms || []).filter(function(f){ return f.last_error; });
      if (broken.length) body.appendChild(el("p","muted","Todavía no se pueden bajar los contactos de " + broken.map(function(f){ return "«" + f.campaign_name + "»"; }).join(", ") + ". Avísale a quien te instaló el panel."));
      if (!d.leads.length){
        body.appendChild(el("p","muted", d.forms && d.forms.length ? "Todavía nadie dejó sus datos." : "Todavía no hay campañas con formulario. Pídele al chat una de clientes potenciales."));
        return;
      }
      d.leads.forEach(function(l){
        var box = el("div","lead");
        var top = el("div","top");
        top.appendChild(el("h3",null,l.full_name || l.email || l.phone || "Sin nombre"));
        top.appendChild(el("span","when", new Date(String(l.created_time).replace("+0000","Z")).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"})));
        box.appendChild(top);
        var dl = el("dl");
        function row(k, v, href){
          if (!v) return;
          dl.appendChild(el("dt",null,k));
          var dd = el("dd");
          if (href){ var a = el("a",null,v); a.href = href; dd.appendChild(a); } else dd.textContent = v;
          dl.appendChild(dd);
        }
        row("Correo", l.email, l.email ? "mailto:" + l.email : null);
        row("Teléfono", l.phone, l.phone ? "tel:" + String(l.phone).replace(/[^+0-9]/g,"") : null);
        JSON.parse(l.fields || "[]").forEach(function(x){ row(x.name, x.value); });
        row("Campaña", l.campaign_name);
        box.appendChild(dl);
        body.appendChild(box);
      });
    }).catch(function(err){ body.className = "muted"; body.textContent = err.message; });
  }

  // Arranque
  function boot(){
    api("api/state" + (currentChat ? "?chat=" + currentChat : "")).then(function(s){
      showApp();
      rememberChat(s.chatId);
      renderChats(s.chats);
      log.textContent = ""; $("draftList").textContent = "";
      (s.drafts || []).forEach(renderDraft);
      if (s.missing.length){
        var NAMES = { META_ACCOUNT_ID:"la cuenta publicitaria", META_PAGE_ID:"la página de Facebook", META_IG_USER_ID:"la cuenta de Instagram", META_PIXEL_ID:"el píxel", META_TOKEN_READ:"el acceso a Meta", OPENAI_API_KEY:"la clave de OpenAI" };
        var names = s.missing.map(function(k){ return NAMES[k]; }).filter(function(x, i, a){ return x && a.indexOf(x) === i; });
        $("notice").textContent = "Falta conectar " + (names.length ? names.join(", ") : "parte de la configuración") + ". Hasta entonces el chat y los resultados no pueden ver tu cuenta.";
        $("notice").classList.remove("hidden");
      } else { $("notice").classList.add("hidden"); }
      var cards = {}; s.actions.forEach(function(a){ cards[a.code] = a; });
      if (!s.messages.length) renderEmpty();
      s.messages.forEach(function(m){
        var match = m.content.match(/\\n\\n\\[propuestas: ([A-Z0-9, ]+)\\]$/);
        addMsg(m.role, match ? m.content.slice(0, match.index) : m.content);
        if (match) match[1].split(", ").forEach(function(c){ if (cards[c]) renderCard(cards[c]); });
      });
    }).catch(function(err){ if (err.message !== "dos pasos") showLogin(); });
  }
  boot();
})();
</script>
</body>
</html>`;
