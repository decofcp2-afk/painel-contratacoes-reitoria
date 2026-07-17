function toggleLinksUteis(ev){
  if (ev) ev.stopPropagation();
  var menu = document.getElementById('links-uteis-menu');
  var btn  = document.getElementById('links-uteis-btn');
  if (!menu) return;
  var aberto = menu.classList.toggle('open');
  if (btn) btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
}
function closeLinksUteis(){
  var menu = document.getElementById('links-uteis-menu');
  var btn  = document.getElementById('links-uteis-btn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
// Fecha o menu ao clicar fora dele
document.addEventListener('click', function(e){
  var wrap = document.querySelector('.links-uteis-wrap');
  if (wrap && !wrap.contains(e.target)) closeLinksUteis();
});
document.addEventListener('keydown', function(e){ if (e.key === 'Escape'){ closeLinksUteis(); fecharAjuda(); } });

function abrirAjuda(){ var m = document.getElementById('ajuda-modal'); if (m) m.classList.add('open'); }
function fecharAjuda(){ var m = document.getElementById('ajuda-modal'); if (m) m.classList.remove('open'); }

// Preenche o rodapé (endereço + e-mail) com os dados da unidade selecionada.
function atualizarRodapeUnidade(){
  if (!(window.PainelFirestore && window.PainelFirestore.carregarDadosUnidade)) return;
  window.PainelFirestore.carregarDadosUnidade().then(function(d){
    if (!d) return;
    var addr = document.getElementById('footer-addr');
    var mail = document.getElementById('footer-email-val');
    if (addr && d.endereco) addr.textContent = d.endereco;
    if (mail && d.emailInstitucional) mail.innerHTML = '✉&nbsp;' + esc(d.emailInstitucional);
  }).catch(function(){});
}
if (document.readyState !== 'loading') atualizarRodapeUnidade();
else document.addEventListener('DOMContentLoaded', atualizarRodapeUnidade);

function abrirTrocaUnidade(){
  var modal = document.getElementById('u-modal');
  var sel = document.getElementById('u-select');
  modal.style.display = 'flex';
  sel.innerHTML = '<option>Carregando…</option>';
  var atual = (window.PainelFirestore && window.PainelFirestore.unidadeAtual && window.PainelFirestore.unidadeAtual()) || 'reitoria-sel';
  if (!(window.PainelFirestore && window.PainelFirestore.listarUnidades)){
    sel.innerHTML = '<option>Indisponível</option>'; return;
  }
  window.PainelFirestore.listarUnidades().then(function(unids){
    if (!unids.length){ sel.innerHTML = '<option value="reitoria-sel">Painel - Reitoria (atual)</option>'; return; }
    sel.innerHTML = unids.map(function(u){
      var atualTxt = (u.id === atual) ? ' (atual)' : '';
      var inativa = u.ativo === false ? ' [inativa]' : '';
      return '<option value="'+esc(u.id)+'"'+(u.id===atual?' selected':'')+'>Painel - '+esc(u.nome||u.id)+atualTxt+inativa+'</option>';
    }).join('');
  }).catch(function(){ sel.innerHTML = '<option value="reitoria-sel">Painel - Reitoria (atual)</option>'; });
}
function aplicarUnidade(id){
  if (!id) return;
  try { localStorage.setItem('painel_unidade', id); } catch(e){}
  // remove ?u= da URL para a unidade salva valer como padrão
  try { history.replaceState(null, '', location.pathname); } catch(e){}
  location.reload();
}
function fecharTrocaUnidade(){ document.getElementById('u-modal').style.display='none'; }
// Mostra a unidade atual no botão (coerência visual).
(function(){
  function rotular(){
    if (!(window.PainelFirestore && window.PainelFirestore.listarUnidades)) return;
    var atual = window.PainelFirestore.unidadeAtual();
    window.PainelFirestore.listarUnidades().then(function(us){
      var u = (us||[]).filter(function(x){return x.id===atual;})[0];
      var nome = u ? (u.nome || atual) : atual;
      var b = document.getElementById('btn-troca-unidade'); if (b) b.textContent = '🏛️ ' + nome + ' ▾';
    }).catch(function(){});
  }
  if (document.readyState !== 'loading') rotular(); else document.addEventListener('DOMContentLoaded', rotular);
})();

// ── Fase 3 (anti-XSS): fiação de eventos via addEventListener ──
// Substitui os antigos handlers inline (onclick=, oninput=, onchange=) para
// permitir CSP com script-src sem 'unsafe-inline'. Nada de comportamento muda.
(function(){
  function wireEvents(){
    var byId = function(id){ return document.getElementById(id); };
    var on = function(el, ev, fn){ if (el) el.addEventListener(ev, fn); };
    var each = function(sel, fn){ Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };

    on(byId('btn-troca-unidade'), 'click', function(){ abrirTrocaUnidade(); });
    on(byId('links-uteis-btn'), 'click', function(e){ toggleLinksUteis(e); });
    on(document.querySelector('.ajuda-btn-desktop'), 'click', function(){ abrirAjuda(); });
    on(document.querySelector('.ajuda-link-mob'), 'click', function(e){ e.preventDefault(); closeLinksUteis(); abrirAjuda(); });
    each('[data-close-lu]', function(a){ a.addEventListener('click', function(){ closeLinksUteis(); }); });

    on(byId('f-search'), 'input', function(){ salvarFiltros(); applyFilters(); });
    on(byId('ano-select'), 'change', function(){ setAnoFilter(this.value); });
    each('.status-btn', function(b){ b.addEventListener('click', function(){ setStatusFilter(this, this.getAttribute('data-s') || ''); }); });
    each('.escala-btn', function(b){ b.addEventListener('click', function(){ setEscala(this, this.getAttribute('data-e')); }); });
    each('.mob-modal-btn', function(b){ b.addEventListener('click', function(){ setMobModal(this, this.getAttribute('data-m') || ''); }); });
    // Legenda clicável (filtro por modalidade). Handlers via addEventListener
    // porque a CSP (script-src sem 'unsafe-inline') bloqueia onclick inline.
    each('.legenda-item[data-modal]', function(it){
      it.addEventListener('click', function(){ setModalFilter(this.getAttribute('data-modal')); });
      it.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModalFilter(this.getAttribute('data-modal')); }
      });
    });

    var uModal = byId('u-modal');
    on(uModal, 'click', function(e){ if (e.target === uModal) fecharTrocaUnidade(); });
    on(byId('u-modal-close'), 'click', function(){ fecharTrocaUnidade(); });
    on(byId('u-select'), 'change', function(){ aplicarUnidade(this.value); });

    var ajModal = byId('ajuda-modal');
    on(ajModal, 'click', function(e){ if (e.target === ajModal) fecharAjuda(); });
    on(byId('ajuda-modal-close'), 'click', function(){ fecharAjuda(); });
  }
  if (document.readyState !== 'loading') wireEvents();
  else document.addEventListener('DOMContentLoaded', wireEvents);
})();
