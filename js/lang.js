(function(){
  var CDN='https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/';

  var LANGS=[
    {code:'en', iso:'gb', name:'English',           eng:'English',              label:'EN'},
    {code:'es', iso:'es', name:'Español',            eng:'Spanish',              label:'ES'},
    {code:'pt', iso:'pt', name:'Português',          eng:'Portuguese',           label:'PT'},
    {code:'fr', iso:'fr', name:'Français',           eng:'French',               label:'FR'},
    {code:'de', iso:'de', name:'Deutsch',            eng:'German',               label:'DE'},
    {code:'ar', iso:'sa', name:'العربية',            eng:'Arabic',               label:'AR'},
    {code:'id', iso:'id', name:'Bahasa Indonesia',   eng:'Indonesian',           label:'ID'},
    {code:'ms', iso:'my', name:'Bahasa Melayu',      eng:'Malay',                label:'MS'},
    {code:'ko', iso:'kr', name:'한국어',              eng:'Korean',               label:'KO'},
    {code:'zh-CN',iso:'cn',name:'中文简体',           eng:'Chinese (Simplified)', label:'ZH'},
    {code:'zh-TW',iso:'tw',name:'中文繁體',           eng:'Chinese (Traditional)',label:'ZH'},
    {code:'vi', iso:'vn', name:'Tiếng Việt',         eng:'Vietnamese',           label:'VI'},
    {code:'th', iso:'th', name:'ไทย',                eng:'Thai',                 label:'TH'},
    {code:'hi', iso:'in', name:'हिंदी',              eng:'Hindi',                label:'HI'},
    {code:'uz', iso:'uz', name:'Oʻzbekcha',          eng:'Uzbek',                label:'UZ'},
    {code:'uk', iso:'ua', name:'Українська',         eng:'Ukrainian',            label:'UK'},
    {code:'ja', iso:'jp', name:'日本語',              eng:'Japanese',             label:'JA'},
    {code:'tr', iso:'tr', name:'Türkçe',             eng:'Turkish',              label:'TR'},
    {code:'ru', iso:'ru', name:'Русский',            eng:'Russian',              label:'RU'},
    {code:'it', iso:'it', name:'Italiano',           eng:'Italian',              label:'IT'},
    {code:'pl', iso:'pl', name:'Polski',             eng:'Polish',               label:'PL'},
    {code:'nl', iso:'nl', name:'Nederlands',         eng:'Dutch',                label:'NL'},
    {code:'ro', iso:'ro', name:'Română',             eng:'Romanian',             label:'RO'},
    {code:'el', iso:'gr', name:'Ελληνικά',           eng:'Greek',                label:'EL'},
    {code:'sv', iso:'se', name:'Svenska',            eng:'Swedish',              label:'SV'},
    {code:'no', iso:'no', name:'Norsk',              eng:'Norwegian',            label:'NO'},
    {code:'da', iso:'dk', name:'Dansk',              eng:'Danish',               label:'DA'},
    {code:'fi', iso:'fi', name:'Suomi',              eng:'Finnish',              label:'FI'},
    {code:'bn', iso:'bd', name:'বাংলা',              eng:'Bengali',              label:'BN'},
    {code:'fa', iso:'ir', name:'فارسی',              eng:'Persian',              label:'FA'},
    {code:'ur', iso:'pk', name:'اردو',               eng:'Urdu',                 label:'UR'},
    {code:'af', iso:'za', name:'Afrikaans',          eng:'Afrikaans',            label:'AF'},
    {code:'cs', iso:'cz', name:'Čeština',            eng:'Czech',                label:'CS'},
    {code:'hu', iso:'hu', name:'Magyar',             eng:'Hungarian',            label:'HU'},
    {code:'bg', iso:'bg', name:'Български',          eng:'Bulgarian',            label:'BG'},
    {code:'sr', iso:'rs', name:'Srpski',             eng:'Serbian',              label:'SR'},
    {code:'tl', iso:'ph', name:'Filipino',           eng:'Filipino',             label:'TL'},
    {code:'sw', iso:'ke', name:'Kiswahili',          eng:'Swahili',              label:'SW'},
    {code:'az', iso:'az', name:'Azərbaycan',         eng:'Azerbaijani',          label:'AZ'},
    {code:'ka', iso:'ge', name:'ქართული',            eng:'Georgian',             label:'KA'}
  ];

  function flagImg(iso,w,h){
    return '<img src="'+CDN+iso+'.svg" width="'+w+'" height="'+h+'" alt="" style="border-radius:2px;flex-shrink:0;display:block;object-fit:cover;">';
  }

  function getActiveLang(){
    return localStorage.getItem('xantex-lang') || 'en';
  }

  function clearGoogTrans(){
    document.cookie='googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
    document.cookie='googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain='+location.hostname;
    document.cookie='googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.'+location.hostname;
  }

  function buildBtn(lang){
    var active=LANGS.find(function(l){return l.code===lang;})||LANGS[0];
    return '<div class="lang-selector">'+
      '<button class="lang-btn" id="langBtn" aria-haspopup="true" aria-expanded="false">'+
        flagImg(active.iso,20,14)+
        '<span id="langLabel">'+active.label+'</span>'+
        '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>'+
      '</button>'+
    '</div>';
  }

  function buildPanel(activeLang){
    var items=LANGS.map(function(l){
      var ac=l.code===activeLang?' active':'';
      return '<button class="lang-item'+ac+'" data-code="'+l.code+'" data-label="'+l.label+'" data-iso="'+l.iso+'">'+
        '<span class="lang-item__flag">'+flagImg(l.iso,28,20)+'</span>'+
        '<span><span class="lang-item__name">'+l.name+'</span>'+
        '<span class="lang-item__eng">'+l.eng+'</span></span>'+
      '</button>';
    }).join('');
    return '<div class="lang-panel" id="langPanel">'+
      '<div class="lang-panel__inner">'+
        '<div class="lang-panel__title">Select Language</div>'+
        '<div class="lang-grid">'+items+'</div>'+
      '</div>'+
    '</div>';
  }

  // Load Google Translate only when needed for a non-English language
  function loadGoogleTranslate(callback){
    if(window._gtLoaded){ if(callback) callback(); return; }
    var gtEl=document.createElement('div');
    gtEl.id='google_translate_element';
    gtEl.style.display='none';
    document.body.appendChild(gtEl);
    window.googleTranslateElementInit=function(){
      new google.translate.TranslateElement({pageLanguage:'en',autoDisplay:false},'google_translate_element');
      window._gtLoaded=true;
      if(callback) setTimeout(callback,600);
    };
    var s=document.createElement('script');
    s.src='//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.body.appendChild(s);
  }

  function doTranslate(code){
    var attempts=0;
    function trySet(){
      var combo=document.querySelector('.goog-te-combo');
      if(combo){
        combo.value=code;
        combo.dispatchEvent(new Event('change'));
      } else if(attempts<20){
        attempts++;
        setTimeout(trySet,300);
      }
    }
    trySet();
  }

  function applyLang(code){
    localStorage.setItem('xantex-lang',code);
    if(code==='en'){
      clearGoogTrans();
      location.reload();
      return;
    }
    if(!window._gtLoaded){
      loadGoogleTranslate(function(){ doTranslate(code); });
    } else {
      doTranslate(code);
    }
  }

  function init(){
    var navbar=document.querySelector('.navbar__inner');
    if(!navbar) return;

    var activeLang=getActiveLang();

    // Always nuke googtrans cookie so Google Translate never auto-translates
    clearGoogTrans();

    var logo=navbar.querySelector('.navbar__logo');
    var btnDiv=document.createElement('div');
    btnDiv.innerHTML=buildBtn(activeLang);
    if(logo&&logo.nextSibling){
      navbar.insertBefore(btnDiv.firstElementChild,logo.nextSibling);
    } else {
      navbar.appendChild(btnDiv.firstElementChild);
    }

    var panelDiv=document.createElement('div');
    panelDiv.innerHTML=buildPanel(activeLang);
    document.body.appendChild(panelDiv.firstElementChild);

    // Only load Google Translate when a non-English language is active
    if(activeLang!=='en'){
      loadGoogleTranslate(function(){ doTranslate(activeLang); });
    }

    var btn=document.getElementById('langBtn');
    var panel=document.getElementById('langPanel');

    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var open=panel.classList.toggle('open');
      btn.classList.toggle('open',open);
      btn.setAttribute('aria-expanded',open);
    });

    document.addEventListener('click',function(e){
      if(!panel.contains(e.target)&&e.target!==btn){
        panel.classList.remove('open');
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded','false');
      }
    });

    panel.addEventListener('click',function(e){
      var item=e.target.closest('.lang-item');
      if(!item) return;
      var code=item.dataset.code;
      var label=item.dataset.label;
      var iso=item.dataset.iso;

      panel.querySelectorAll('.lang-item').forEach(function(el){el.classList.remove('active');});
      item.classList.add('active');

      var btnFlag=btn.querySelector('img');
      if(btnFlag) btnFlag.src=CDN+iso+'.svg';
      document.getElementById('langLabel').textContent=label;

      panel.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded','false');

      applyLang(code);
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init);
  } else {
    init();
  }
})();
