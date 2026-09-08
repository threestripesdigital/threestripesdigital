// Compact opportunity view. Values come from the existing ranking response.
window.renderBoostPopup = function (data, show) {
  var keywords = data.keywords || [];
  var selected = 0;
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); };
  var count = function (n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  var escape = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); };
  var gap = function (k) { return Math.max(0, Number(k.opp_value || 0) - Number(k.now_value || 0)); };
  function cta(note) {
    return '<div class="rb-cta-block"><button type="button" class="rb-book step-cta">Book My Free Boost Call →</button><p class="rb-foot-note">' + note + '</p></div>';
  }
  var total = keywords.reduce(function (sum, k) { return sum + gap(k); }, 0);
  var eligible = Number(data.total) || keywords.length;
  show('<div class="rb-content"><div class="rb-summary"><h2>You have <span>' + count(eligible) + ' keyword' + (eligible === 1 ? '' : 's') + '</span><br>eligible to be boosted.</h2><div class="rb-total-label">Estimated monthly upside</div><div class="rb-total">' + money(total) + '<small> / month</small></div><div class="rb-total-context">Across ' + keywords.length + ' keyword' + (keywords.length === 1 ? '' : 's') + ', modeled at the #1 position.</div>' + cta('Choose a time. We’ll review your keywords and plan your free boost.') + '</div><div class="rb-section-head"><h3>Your keyword opportunities</h3><span>Select a keyword to see the math</span></div><table aria-label="Your keyword opportunities"><thead><tr><th scope="col">Keyword</th><th scope="col">Rank</th><th scope="col">Monthly upside</th></tr></thead><tbody>' + keywords.map(function (k, i) { return '<tr><td><button type="button" class="rb-keyword-button" data-keyword="' + i + '">' + escape(k.keyword) + '</button></td><td>#' + escape(k.position) + '</td><td>' + money(gap(k)) + '</td></tr>'; }).join('') + '</tbody></table>' + cta('On your free call, we’ll help you choose which keyword to boost.') + '<div class="rb-math" aria-live="polite"></div></div><div class="rb-foot">' + cta('Pick a time for your free 30-minute call. No credit card needed.') + '</div>');
  var root = document.getElementById('step-result');
  function math() {
    var k = keywords[selected];
    if (!k) return;
    function line(label, value) { return '<div class="rb-math-line"><span>' + label + '</span><strong>' + value + '</strong></div>'; }
    root.querySelector('.rb-math').innerHTML = '<h3>The math explained</h3><div class="rb-selected-keyword">' + escape(k.keyword) + '</div>' + line('Monthly searches', count(k.volume)) + line('× 40% click share', count(Math.round(Number(k.volume) * .4)) + ' visits') + line('× 10% inquiry rate', count(Math.round(Number(k.volume) * .4) * .1) + ' inquiries') + line('× 20% close rate', count(Math.round(Number(k.volume) * .4) * .02) + ' cases') + line('× ' + money(k.case_value) + ' per case', money(k.opp_value) + ' / mo') + line('Minus current monthly value', '− ' + money(k.now_value)) + '<div class="rb-math-total"><span>Estimated monthly upside</span><strong>' + money(gap(k)) + '<small> / month</small></strong></div>';
    root.querySelectorAll('[data-keyword]').forEach(function (button, index) { button.setAttribute('aria-pressed', String(index === selected)); button.closest('tr').classList.toggle('rb-selected', index === selected); });
  }
  root.querySelectorAll('[data-keyword]').forEach(function (button) { button.onclick = function () { selected = Number(button.dataset.keyword); math(); }; });
  math();
};
