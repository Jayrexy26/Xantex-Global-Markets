(function(){
  var LANGS=[
    {code:'en',flag:'🇬🇧',name:'English',eng:'English',label:'EN'},
    {code:'es',flag:'🇪🇸',name:'Español',eng:'Spanish',label:'ES'},
    {code:'pt',flag:'🇵🇹',name:'Português',eng:'Portuguese',label:'PT'},
    {code:'fr',flag:'🇫🇷',name:'Français',eng:'French',label:'FR'},
    {code:'de',flag:'🇩🇪',name:'Deutsch',eng:'German',label:'DE'},
    {code:'ar',flag:'🇸🇦',name:'العربية',eng:'Arabic',label:'AR'},
    {code:'id',flag:'🇮🇩',name:'Bahasa Indonesia',eng:'Indonesian',label:'ID'},
    {code:'ms',flag:'🇲🇾',name:'Bahasa Melayu',eng:'Malay',label:'MS'},
    {code:'ko',flag:'🇰🇷',name:'한국어',eng:'Korean',label:'KO'},
    {code:'zh-CN',flag:'🇨🇳',name:'中文简体',eng:'Chinese (Simplified)',label:'ZH'},
    {code:'zh-TW',flag:'🇹🇼',name:'中文繁體',eng:'Chinese (Traditional)',label:'ZH'},
    {code:'vi',flag:'🇻🇳',name:'Tiếng Việt',eng:'Vietnamese',label:'VI'},
    {code:'th',flag:'🇹🇭',name:'ไทย',eng:'Thai',label:'TH'},
    {code:'hi',flag:'🇮🇳',name:'हिंदी',eng:'Hindi',label:'HI'},
    {code:'uz',flag:'🇺🇿',name:'Oʻzbekcha',eng:'Uzbek',label:'UZ'},
    {code:'uk',flag:'🇺🇦',name:'Українська',eng:'Ukrainian',label:'UK'},
    {code:'ja',flag:'🇯🇵',name:'日本語',eng:'Japanese',label:'JA'},
    {code:'tr',flag:'🇹🇷',name:'Türkçe',eng:'Turkish',label:'TR'},
    {code:'ru',flag:'🇷🇺',name:'Русский',eng:'Russian',label:'RU'},
    {code:'it',flag:'🇮🇹',name:'Italiano',eng:'Italian',label:'IT'},
    {code:'pl',flag:'🇵🇱',name:'Polski',eng:'Polish',label:'PL'},
    {code:'nl',flag:'🇳🇱',name:'Nederlands',eng:'Dutch',label:'NL'},
    {code:'ro',flag:'🇷🇴',name:'Română',eng:'Romanian',label:'RO'},
    {code:'el',flag:'🇬🇷',name:'Ελληνικά',eng:'Greek',label:'EL'},
    {code:'sv',flag:'🇸🇪',name:'Svenska',eng:'Swedish',label:'SV'},
    {code:'no',flag:'🇳🇴',name:'Norsk',eng:'Norwegian',label:'NO'},
    {code:'da',flag:'🇩🇰',name:'Dansk',eng:'Danish',label:'DA'},
    {code:'fi',flag:'🇫🇮',name:'Suomi',eng:'Finnish',label:'FI'},
    {code:'bn',flag:'🇧🇩',name:'বাংলা',eng:'Bengali',label:'BN'},
    {code:'fa',flag:'🇮🇷',name:'فارسی',eng:'Persian',label:'FA'},
    {code:'ur',flag:'🇵🇰',name:'اردو',eng:'Urdu',label:'UR'},
    {code:'af',flag:'🇿🇦',name:'Afrikaans',eng:'Afrikaans',label:'AF'},
    {code:'cs',flag:'🇨🇿',name:'Čeština',eng:'Czech',label:'CS'},
    {code:'hu',flag:'🇭🇺',name:'Magyar',eng:'Hungarian',label:'HU'},
    {code:'bg',flag:'🇧🇬',name:'Български',eng:'Bulgarian',label:'BG'},
    {code:'sr',flag:'🇷🇸',name:'Srpski',eng:'Serbian',label:'SR'},
    {code:'tl',flag:'🇵🇭',name:'Filipino',eng:'Filipino',label:'TL'},
    {code:'sw',flag:'🇰🇪',name:'Kiswahili',eng:'Swahili',label:'SW'},
    {code:'az',flag:'🇦🇿',name:'Azərbaycan',eng:'Azerbaijani',label:'AZ'},
    {code:'ka',flag:'🇬🇪',name:'ქართული',eng:'Georgian',label:'KA'}
  ];

  function getCookie(name){
    var m=document.cookie.match('(^|;)\\s*'+name+'\\s*=\\s*([^;]+)');
    return m?decodeURIComponent(m[2]):null;
  }

  function getActiveLang(){
    var c=getCookie('googtrans');
    if(!c)return 'en';
    var p=c.split('/');
    return p[2]||'en';
  }

  function buildBtn(lang){
    var active=LANGS.find(function(l){return l.code===lang;})||LANGS[0];
    return '<div class="lang-selector">'+
      '<button class="lang-btn" id="langBtn" aria-haspopup="true" aria-expanded="false">'+
        '<span class="lang-globe">🌐</span>'+
        '<span id="langLabel">'+active.label+'</span>'+
        '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>'+
      '</button>'+
    '</div>';
  }

  function buildPanel(activeLang){
    var items=LANGS.map(function(l){
      var ac=l.code===activeLang?' active':'';
      return '<button class="lang-item'+ac+'" data-code="'+l.code+'" data-label="'+l.label+'">'+
        '<span class="lang-item__flag">'+l.flag+'</span>'+
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

  function applyLang(code){
    if(code==='en'){
      document.cookie='googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
      document.cookie='googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain='+location.hostname;
      location.reload();
      return;
    }
    var attempts=0;
    function trySet(){
      var combo=document.querySelector('.goog-te-combo');
      if(combo){
        combo.value=code;
        combo.dispatchEvent(new Event('change'));
      } else if(attempts<15){
        attempts++;
        setTimeout(trySet,300);
      }
    }
    trySet();
  }

  function init(){
    var navbar=document.querySelector('.navbar__inner');
    if(!navbar)return;

    var activeLang=getActiveLang();

    // Inject button after logo
    var logo=navbar.querySelector('.navbar__logo');
    var btnDiv=document.createElement('div');
    btnDiv.innerHTML=buildBtn(activeLang);
    if(logo&&logo.nextSibling){
      navbar.insertBefore(btnDiv.firstElementChild,logo.nextSibling);
    } else {
      navbar.appendChild(btnDiv.firstElementChild);
    }

    // Inject panel into body
    var panelDiv=document.createElement('div');
    panelDiv.innerHTML=buildPanel(activeLang);
    document.body.appendChild(panelDiv.firstElementChild);

    // Inject hidden Google Translate element
    var gtEl=document.createElement('div');
    gtEl.id='google_translate_element';
    gtEl.style.display='none';
    document.body.appendChild(gtEl);

    // Load Google Translate script
    window.googleTranslateElementInit=function(){
      new google.translate.TranslateElement({pageLanguage:'en',autoDisplay:false},'google_translate_element');
    };
    var s=document.createElement('script');
    s.src='//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.body.appendChild(s);

    // Wire up toggle
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

    // Language item clicks
    panel.addEventListener('click',function(e){
      var item=e.target.closest('.lang-item');
      if(!item)return;
      var code=item.dataset.code;
      var label=item.dataset.label;

      // Update active states
      panel.querySelectorAll('.lang-item').forEach(function(el){el.classList.remove('active');});
      item.classList.add('active');
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
