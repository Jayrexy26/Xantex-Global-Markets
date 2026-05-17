(function () {
  var URL  = 'https://ywnpzjjpighjhhqoxtsj.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3bnB6ampwaWdoamhocW94dHNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1Mjc4OTUsImV4cCI6MjA5MzEwMzg5NX0.lfeKjFfNsCoy1UaQ0ASIUD08fUq8mhY-1gbMPzrjYDE';

  function apply(s) {
    var name  = s.platform_name  || '';
    var email = s.support_email  || '';
    var phone = s.support_phone  || '';

    // ── data-plat attribute targets ────────────────────────────
    document.querySelectorAll('[data-plat]').forEach(function (el) {
      var t = el.getAttribute('data-plat');
      if (t === 'name'  && name)  { el.textContent = name; }
      if (t === 'email' && email) {
        el.textContent = email;
        if (el.tagName === 'A') el.href = 'mailto:' + email;
      }
      if (t === 'phone' && phone) {
        el.textContent = phone;
        if (el.tagName === 'A') el.href = 'tel:' + phone.replace(/[^+\d]/g, '');
      }
      if (t === 'email-href' && email && el.tagName === 'A') el.href = 'mailto:' + email;
      if (t === 'phone-href' && phone && el.tagName === 'A') el.href = 'tel:' + phone.replace(/[^+\d]/g, '');
    });

    // ── Footer contact line — phone & email links ──────────────
    if (phone) {
      document.querySelectorAll('.footer-nav__contact').forEach(function (el) {
        el.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
          a.href = 'tel:' + phone.replace(/[^+\d]/g, '');
          a.textContent = phone;
        });
        // Also replace bare phone text nodes
        el.childNodes.forEach(function (node) {
          if (node.nodeType === 3) {
            node.textContent = node.textContent.replace(/\+[\d\s().–-]{6,}/, phone);
          }
        });
      });
    }
    if (email) {
      document.querySelectorAll('.footer-nav__contact a[href^="mailto:"]').forEach(function (a) {
        a.href = 'mailto:' + email;
        if (a.textContent.includes('@')) a.textContent = email;
      });
    }

    // ── Copyright line ─────────────────────────────────────────
    if (name) {
      document.querySelectorAll('.footer-disclaimer__copy').forEach(function (el) {
        el.textContent = el.textContent.replace(/Xantex Global Markets/g, name);
      });
      document.querySelectorAll('.footer-disclaimer__inner').forEach(function (el) {
        el.innerHTML = el.innerHTML.replace(/Xantex Global Markets Ltd/g, name + ' Ltd');
      });
    }
  }

  function load() {
    fetch(URL + '/rest/v1/platform_settings?key=in.(platform_name,support_email,support_phone)&select=key,value', {
      headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON }
    })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        var s = {};
        (rows || []).forEach(function (r) { s[r.key] = r.value; });
        apply(s);
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
