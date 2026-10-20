(function(){
  "use strict";

  var fmt = new Intl.NumberFormat('es-PY',{maximumFractionDigits:0});
  var _noop=document.createElement('span');
  var el = function(id){ var e=document.getElementById(id); if(!e){ if(window.console&&console.warn) console.warn('elemento faltante:',id); return _noop; } return e; };
  var pn = function(v){ var n = parseInt(String(v).replace(/\D/g,''),10); return isNaN(n)?0:n; };
  var gs = function(n){ return fmt.format(Math.round(n)); };
  var MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  var LARGO = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  function mesRef(){ var d=new Date(); return LARGO[d.getMonth()]; }
  function mesRefCap(){ var m=mesRef(); return m.charAt(0).toUpperCase()+m.slice(1); }
  // el mes 0 de la simulación es el mes en curso
  var MES0 = new Date().getMonth(), ANIO0 = new Date().getFullYear();

  function nombreMes(off, largo){
    var i = (MES0+off)%12, a = ANIO0 + Math.floor((MES0+off)/12);
    return largo ? LARGO[i] + ' ' + a : MESES[i];
  }

  // ============ ESTADO ============
  // Perfil neutro. Tus datos reales (deudas, tasas, cuotas, mínimos) no viven en el código:
  // se cargan desde tu archivo de perfil privado o se cargan a mano, y quedan en este dispositivo.
  // Cada deuda del perfil:
  //   tarjeta:  {id, nm, corto, tipo:'tarjeta',  tasa, cargo, minimo, saldoInicial, detalle, patrones}
  //   préstamo: {id, nm, corto, tipo:'prestamo', cuota, total, tasa, capital, recalc, detalle, patrones}
  // El saldo vive aparte, en st.deudas[id]: guaraníes en tarjetas, cuotas que faltan en préstamos.
  var PERFIL_DEMO = {
    demo:true,
    cuenta:'tu cuenta',
    cobroMonto:0,
    puenteMonto:0,
    deudas:[]
  };
  var HOY0 = new Date().toISOString().slice(0,10);
  var BASE = {
    perfil:PERFIL_DEMO,
    ing:{usd:0, tc:7000, fee:0, retiros:1, extra:0},
    aporte:0, puente:false,
    saldo:0, cobro:'',
    ciclo:{inicio:HOY0, cobros:[]},
    ahorros:[
      {id:'a1', nm:'Fondo de emergencia', obj:0, guardado:0, aporte:0, fecha:(new Date().getFullYear()+1)+'-01-01',
       nota:'Un colchón para que los imprevistos no terminen en la tarjeta.'}
    ],
    extras:[],
    sel:'delivery',
    movs:[],
    todos:[],
    deudas:{},
    grupos:[
      {id:'fijo', t:'Gastos fijos', n:'Salen todos los meses. No se recortan.', items:[
        {id:'gym',   nm:'Gimnasio', meta:0, corto:'Gym'},
        {id:'claro', nm:'Celular', meta:0, corto:'Celu'}
      ]},
      {id:'var', t:'Gastos variables', n:'Acá está toda la plata recortable.', items:[
        {id:'delivery',nm:'Delivery y restaurantes', meta:0, corto:'Comida afuera'},
        {id:'super',   nm:'Supermercado', meta:0, corto:'Súper'},
        {id:'nafta',   nm:'Combustible', meta:0, corto:'Nafta'},
        {id:'subs',    nm:'Suscripciones', meta:0, corto:'Subs'},
        {id:'transf',  nm:'Transferencias a personas', meta:0, corto:'Transfer.'},
        {id:'compras', nm:'Compras y tiendas', meta:0, corto:'Compras'},
        {id:'salud',   nm:'Salud y farmacia', meta:0, corto:'Salud'},
        {id:'mascota', nm:'Mascota', meta:0, corto:'Mascota'},
        {id:'otros',   nm:'Otros e imprevistos', meta:0, corto:'Otros'}
      ]},
      {id:'ahorro', t:'Ahorro', n:'Mientras haya tarjetas abiertas, el fondo rinde más que cualquier inversión.', items:[
        {id:'fondo',   nm:'Fondo de emergencia', meta:0, corto:'Fondo'}
      ]}
    ]
  };
  var clon = function(o){ if(o===undefined||o===null) return o; try{ return JSON.parse(JSON.stringify(o)); }catch(e){ return o; } };
  var st = clon(BASE);

  // Perfil activo y lista de deudas (se recalculan en aplicarPerfil cada vez que se renderiza)
  var DEUDAS_META=[], PERFIL=PERFIL_DEMO;
  function aplicarPerfil(){
    if(!st.perfil || typeof st.perfil!=='object') st.perfil=clon(PERFIL_DEMO);
    if(!Array.isArray(st.perfil.deudas)) st.perfil.deudas=[];
    if(!st.deudas || typeof st.deudas!=='object') st.deudas={};
    // guardados viejos tenían un único "recalcula intereses" global para el préstamo con tasa
    if(st.recalc!==undefined){
      if(st.recalc) st.perfil.deudas.forEach(function(m){ if(m.tipo==='prestamo' && m.capital>0 && m.recalc===undefined) m.recalc=true; });
      delete st.recalc;
    }
    delete st.aporteCard; // campo viejo sin uso
    PERFIL=st.perfil;
    DEUDAS_META=PERFIL.deudas;
  }
  function deudaPorId(id){ return DEUDAS_META.filter(function(x){return x.id===id;})[0]; }
  function esPrestamo(m){ return m.tipo==='prestamo'; }
  function tarjetas(){ return DEUDAS_META.filter(function(m){ return !esPrestamo(m); }); }
  function prestamos(){ return DEUDAS_META.filter(esPrestamo); }
  function nombreDeuda(id){
    var d=deudaPorId(id);
    return d?d.nm:'Deuda borrada';
  }
  // saldo en guaraníes (en préstamos: cuotas que faltan × cuota)
  function saldoDe(m){ var v=st.deudas[m.id]||0; return esPrestamo(m) ? v*(m.cuota||0) : v; }
  function deudaTotal(){ return DEUDAS_META.reduce(function(s,m){ return s+saldoDe(m); },0); }
  // aplica un pago sobre el saldo de la deuda
  function aplicarPagoDeuda(id, monto, revertir){
    var meta=deudaPorId(id);
    if(!meta) return;
    var sg = revertir ? -1 : 1;
    if(meta.tipo==='prestamo'){
      var n=meta.cuota>0 ? Math.max(1, Math.round(monto/meta.cuota)) : 1;
      st.deudas[id]=Math.max(0, (st.deudas[id]||0) - sg*n);
    } else {
      st.deudas[id]=Math.max(0, (st.deudas[id]||0) - sg*monto);
    }
  }
  aplicarPerfil();

  function defaultCobro(){ var d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+1); return d.toISOString().slice(0,10); }
  function todosItems(){ return st.grupos.reduce(function(a,g){ return a.concat(g.items); },[]); }
  function totalMetas(){ return todosItems().reduce(function(s,i){return s+i.meta;},0); }
  function cuotasFijas(){
    return prestamos().reduce(function(s,m){ return s + ((st.deudas[m.id]||0)>0 ? (m.cuota||0) : 0); },0);
  }
  function ingreso(){
    var i = st.ing;
    return Math.max(0, (i.usd - i.fee*Math.max(1,i.retiros)) * i.tc + i.extra);
  }
  function esGasto(v){ return v.tipo!=='deuda' && v.tipo!=='ahorro'; }
  // Saneamiento completo de datos cargados o restaurados. Corrige categorías,
  // reubica gastos mal puestos en 'otros', y elimina movimientos duplicados.
  function sanearDatos(d){
    d.movs = Array.isArray(d.movs) ? d.movs : [];
    d.todos = Array.isArray(d.todos) ? d.todos : [];
    // limpiar la etiqueta falsa 'impago del ciclo anterior' y fusionar pendientes duplicados
    // (mismo nombre + misma deuda/cat), quedándose con el de fecha más próxima no tildado
    d.todos.forEach(function(t){
      if(t.nota) t.nota = t.nota.replace(/\s*Quedó impago del ciclo anterior\.?/,'').trim();
    });
    var porClave={}, todosLimpios=[];
    d.todos.forEach(function(t){
      var clave = (t.nm||'')+'|'+(t.deuda||'')+'|'+(t.cat||'');
      if(!porClave[clave]){ porClave[clave]=t; todosLimpios.push(t); }
      else {
        // ya hay uno con esa clave: conservar el no-tildado con fecha más temprana
        var prev=porClave[clave];
        // si el previo está tildado y este no, o este vence antes, reemplazar
        if((prev.hecho && !t.hecho)){ /* mantener prev tildado como histórico? no: preferir pendiente */ }
        // en duplicados de pagos fijos, nos quedamos con UNO solo (el de fecha menor no tildado)
        var elegirEste = (!t.hecho && (prev.hecho || (t.f||'')<(prev.f||'')));
        if(elegirEste){
          var idx=todosLimpios.indexOf(prev);
          if(idx>=0) todosLimpios[idx]=t;
          porClave[clave]=t;
        }
      }
    });
    d.todos = todosLimpios;
    // 1) devolver categoría a pendientes que la perdieron
    var CATFIX = {t8:'gym', t9:'tenis', t12:'mascota'};
    d.todos.forEach(function(t){ if(CATFIX[t.id] && !t.cat) t.cat=CATFIX[t.id]; });
    // 2) corregir movimientos con src cuya cat no coincide con la del pendiente
    d.movs.forEach(function(m){ if(m.src && CATFIX[m.src] && m.cat!==CATFIX[m.src]){ m.cat=CATFIX[m.src]; } });
    // 3) reubicar movimientos en 'otros' cuyo texto coincide con una categoría real
    var mapaNom = {};
    (d.grupos||[]).forEach(function(g){ (g.items||[]).forEach(function(i){
      if(i.nm) mapaNom[i.nm.toLowerCase()] = i.id;
      if(i.corto) mapaNom[i.corto.toLowerCase()] = i.id;
    }); });
    d.movs.forEach(function(m){
      if((m.cat==='otros' || !m.cat) && m.d){
        var clave=m.d.toLowerCase().trim();
        for(var nom in mapaNom){
          if(nom && nom!=='otros' && (clave===nom || clave.indexOf(nom)===0)){ m.cat=mapaNom[nom]; break; }
        }
      }
    });
    // 4) eliminar movimientos DUPLICADOS (misma cat + monto + fecha + detalle)
    var vistos={}, limpios=[];
    d.movs.forEach(function(m){
      var clave=(m.cat||'')+'|'+m.monto+'|'+(m.f||'')+'|'+(m.d||'')+'|'+(m.src||'');
      if(!vistos[clave]){ vistos[clave]=true; limpios.push(m); }
    });
    d.movs = limpios;
    // 5) quitar gastos ANOTADOS a mano que duplican un pendiente de gasto ya tildado.
    //    Si el pendiente Tenis está tildado, ya aporta su monto; los gastos sueltos con
    //    el mismo nombre y monto son registros redundantes de ese mismo pago.
    d.todos.forEach(function(t){
      if(t.hecho && t.cat && !t.deuda && t.monto>0){
        var nombreLc=(t.nm||'').toLowerCase();
        d.movs = d.movs.filter(function(m){
          // conservar el movimiento propio del pendiente (src) y los que no coincidan
          if(m.src===t.id) return true;
          var esDelMismo = m.cat===t.cat && Math.abs(m.monto-t.monto)<1;
          var textoCoincide = m.d && m.d.toLowerCase().indexOf(nombreLc.split(' ')[0])===0;
          // quitar solo si NO tiene src (fue anotado a mano) y coincide en categoría+monto
          if(!m.src && esDelMismo && textoCoincide) return false;
          return true;
        });
      }
    });
    // 5b) inferir la deuda de pendientes de pago de tarjeta/préstamo por su nombre
    //     (ej: 'Pago tarjeta X' sin deuda asignada -> la deuda X)
    //     Los patrones de cada deuda vienen del perfil privado.
    var NOMBRE_A_DEUDA = [];
    ((d.perfil && d.perfil.deudas) || DEUDAS_META).forEach(function(m){
      (m.patrones||[]).forEach(function(p){
        try{ NOMBRE_A_DEUDA.push({re:new RegExp(p,'i'), id:m.id}); }catch(e){}
      });
    });
    d.todos.forEach(function(t){
      if(!t.deuda && !t.cat && t.nm){
        for(var k=0;k<NOMBRE_A_DEUDA.length;k++){
          if(NOMBRE_A_DEUDA[k].re.test(t.nm)){ t.deuda=NOMBRE_A_DEUDA[k].id; break; }
        }
      }
    });
    // 5c) corregir movimientos que quedaron como gasto en 'otros' pero son pagos de deuda
    d.movs.forEach(function(m){
      if((!m.tipo || m.tipo==='gasto') && m.cat==='otros' && m.d){
        var dl=m.d.toLowerCase();
        if(dl.indexOf('pago tarjeta')===0 || dl.indexOf('pago a tarjeta')===0 || dl.indexOf('cuota préstamo')===0 || dl.indexOf('cuota prestamo')===0){
          for(var k=0;k<NOMBRE_A_DEUDA.length;k++){
            if(NOMBRE_A_DEUDA[k].re.test(m.d)){ m.cat=NOMBRE_A_DEUDA[k].id; m.tipo='deuda'; break; }
          }
        }
      }
    });
    // 5d) quitar movimientos de deuda DUPLICADOS (misma deuda + monto), conservando uno
    var vistoDeuda={}, movLimpios=[];
    d.movs.forEach(function(m){
      if(m.tipo==='deuda'){
        var clave=m.cat+'|'+m.monto;
        if(vistoDeuda[clave]){ return; } // ya hay un pago igual, descartar duplicado
        vistoDeuda[clave]=true;
      }
      movLimpios.push(m);
    });
    d.movs=movLimpios;
    // 6) reparar consistencia pendiente<->movimiento
    d.todos.forEach(function(t){
      if(t.monto>0){
        var tieneMov=d.movs.some(function(m){ return m.src===t.id; });
        // ademas, si es pago de deuda, ver si ya hay un pago equivalente sin src
        var yaPagadaDeuda = t.deuda && d.movs.some(function(m){ return m.tipo==='deuda' && m.cat===t.deuda && Math.abs(m.monto-t.monto)<1; });
        if(t.hecho && !tieneMov && !yaPagadaDeuda){
          if(t.deuda) d.movs.push({cat:t.deuda, tipo:'deuda', monto:t.monto, f:t.f||'', src:t.id, d:t.nm});
          else d.movs.push({cat:(t.cat||'otros'), monto:t.monto, f:t.f||'', src:t.id, d:t.nm});
        } else if(!t.hecho && tieneMov){
          d.movs=d.movs.filter(function(m){ return m.src!==t.id; });
        }
      }
    });
    // 7) corregir registros de historial mal etiquetados por el bug viejo:
    //    si la etiqueta del mes coincide con el mes en que se cerró, el mes real
    //    era el ANTERIOR (se archivaba con el mes de cierre en vez del mes del ciclo).
    var LARGOm = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    (d.hist||[]).forEach(function(h){
      // completar registros viejos sin ingreso/presupuesto con los valores conocidos
      if(h.ingreso===undefined){
        try{ h.ingreso = (d.ing.usd - d.ing.fee*Math.max(1,d.ing.retiros))*d.ing.tc + (d.ing.extra||0); }catch(e){}
      }
      if(h.presupuestado===undefined){
        var tm=0;
        (d.grupos||[]).forEach(function(g){ if(g.id!=='ahorro') (g.items||[]).forEach(function(i){ tm+=(i.meta||0); }); });
        h.presupuestado = tm;
      }
      if(h.etiqueta && h.cerrado && !h._fix){
        var mesCierre = new Date(h.cerrado+'T00:00:00').getMonth();
        var partes = h.etiqueta.toLowerCase().split(' ');
        var mesEtiqueta = LARGOm.indexOf(partes[0]);
        var anio = parseInt(partes[1],10) || new Date(h.cerrado+'T00:00:00').getFullYear();
        if(mesEtiqueta===mesCierre){
          // estaba mal: correr un mes hacia atrás
          var nuevoMes = (mesEtiqueta-1+12)%12;
          var nuevoAnio = mesEtiqueta===0 ? anio-1 : anio;
          h.etiqueta = LARGOm[nuevoMes]+' '+nuevoAnio;
          h._fix = true; // marcar para no volver a corregirlo
        }
      }
    });
    return d;
  }

  function gastadoPorCat(){
    var m = {};
    todosItems().forEach(function(i){ m[i.id]=0; });
    // 1) sumar los movimientos de gasto anotados
    var idsConMov = {};
    st.movs.filter(esGasto).forEach(function(v){
      m[v.cat] = (m[v.cat]||0) + v.monto;
      if(v.src) idsConMov[v.src]=true;
    });
    // 2) sumar los pendientes de gasto TILDADOS que no tengan ya su movimiento
    //    (así la barra refleja el tilde aunque el movimiento se haya perdido)
    (st.todos||[]).forEach(function(t){
      if(t.hecho && t.cat && !t.deuda && t.monto>0 && !idsConMov[t.id]){
        m[t.cat] = (m[t.cat]||0) + t.monto;
      }
    });
    return m;
  }
  function sumaTipo(t){
    return st.movs.filter(function(v){ return v.tipo===t; }).reduce(function(a,v){return a+v.monto;},0);
  }
  function pendiente(){
    return (st.todos||[]).reduce(function(s,t){ return s + (t.hecho?0:t.monto); },0);
  }
  // solo lo que vence antes del proximo cobro: eso es lo que hay que reservar hoy
  function totalExtras(){
    return (st.extras||[]).reduce(function(a,r){ return a+r.monto; },0);
  }
  function reservadoPend(){
    var lim = st.cobro || '9999-12-31';
    return (st.todos||[]).reduce(function(s,t){ return s + ((!t.hecho && t.f<lim)?t.monto:0); },0);
  }
  function reservado(){ return reservadoPend(); }
  function diasHasta(f){
    var h=new Date(); h.setHours(0,0,0,0);
    return Math.round((new Date(f+'T00:00:00') - h)/86400000);
  }
  function dias(){
    if(!st.cobro) return 1;
    var h=new Date(); h.setHours(0,0,0,0);
    return Math.max(1, Math.ceil((new Date(st.cobro+'T00:00:00') - h)/86400000));
  }

  // ============ SIMULACIÓN ============
  function simular(){
    // costo real anual de cada tarjeta = tasa + cargos fijos sobre el saldo. Define el orden de avalancha.
    var cards=tarjetas().map(function(m){
      return {id:m.id, c:m.nm, s:st.deudas[m.id]||0, i:Math.pow(1+(m.tasa||0),1/12)-1,
              cg:m.cargo||0, min:m.minimo||0, fin:null};
    });
    // préstamos: cuota fija. Los que tienen tasa aceptan adelantos con lo que sobre del aporte;
    // si el banco recalcula intereses al precancelar, el saldo parte del capital y genera interés.
    var loans=prestamos().map(function(m){
      var r=st.deudas[m.id]||0, cuota=m.cuota||0;
      return {id:m.id, c:m.nm, r:r, cuota:cuota, fin:null, recalc:!!m.recalc,
              prepago:(m.tasa||0)>0 && cuota>0,
              s: m.recalc ? (m.capital||0) : r*cuota, i:Math.pow(1+(m.tasa||0),1/12)-1};
    });

    var cal=[], interes=0, libre=0, MAX=60, m;
    var ordenInicial=null;

    // cuánto ya abonaste este ciclo a cada deuda (para no contarlo de nuevo en el mes 0)
    var yaAbonado={};
    (st.movs||[]).forEach(function(mv){ if(mv.tipo==='deuda'){ yaAbonado[mv.cat]=(yaAbonado[mv.cat]||0)+mv.monto; } });
    var totalYaAbonado=Object.keys(yaAbonado).reduce(function(a,k){return a+yaAbonado[k];},0);

    for(m=0;m<MAX;m++){
      var desvio=(st.puente && m<2)?(PERFIL.puenteMonto||0):0;
      // en el mes 0, el aporte disponible ya fue parcialmente usado con lo que abonaste
      var aporteMes = m===0 ? Math.max(0, st.aporte - totalYaAbonado) : st.aporte;
      var pool=Math.max(0, aporteMes - desvio)+libre;
      var f={m:m, p:{}, cierra:[], objetivo:null};

      // interés y cargos del mes
      cards.forEach(function(c){ if(c.s>0){ var x=c.s*c.i; interes+=x+c.cg; c.s+=x+c.cg; } });

      var vivas=cards.filter(function(c){return c.s>0;});
      // ordenar por costo real descendente: esa es la avalancha
      vivas.sort(function(a,b){
        var ca=(a.i + a.cg/Math.max(a.s,1)), cb=(b.i + b.cg/Math.max(b.s,1));
        return cb-ca;
      });
      if(vivas.length) f.objetivo=vivas[0].id;

      // 1) mínimo de cada tarjeta viva
      vivas.forEach(function(c){
        if(pool>0){ var pg=Math.min(c.min, c.s, pool); c.s-=pg; pool-=pg; f.p[c.id]=(f.p[c.id]||0)+pg; }
      });
      // 2) todo el resto entero a la más cara, después la siguiente
      vivas.forEach(function(c){
        if(c.s>0 && pool>0){ var pg=Math.min(pool,c.s); c.s-=pg; pool-=pg; f.p[c.id]=(f.p[c.id]||0)+pg; }
        if(c.s<1 && c.fin===null){ c.s=0; c.fin=m; f.cierra.push(c.c); }
      });

      // préstamos: cuota fija
      loans.forEach(function(l){
        if(l.r<=0) return;
        f.p[l.id]=l.cuota;
        if(l.recalc){ var iu=l.s*l.i; interes+=iu; l.s+=iu-l.cuota; } else { l.s-=l.cuota; }
        l.r--;
        if(l.prepago && pool>0 && l.s>0){ var pre=Math.min(pool,l.s); l.s-=pre; pool-=pre; f.p[l.id]+=pre; l.r=Math.max(0,Math.ceil(l.s/l.cuota)); }
        if(l.s<=1||l.r===0){ l.s=0; l.r=0; if(l.fin===null){ l.fin=m; libre+=l.cuota; f.cierra.push(l.c);} }
      });

      cal.push(f);
      if(!cards.some(function(c){return c.s>0;}) && !loans.some(function(l){return l.r>0;})) break;
    }

    return {
      meses:m+1, cal:cal, interes:interes,
      finTar: (function(){
        var conSaldo=cards.filter(function(c){return c.fin!==null || c.s>0;});
        if(!conSaldo.length) return -1; // no había tarjetas con saldo
        return conSaldo.reduce(function(a,c){return Math.max(a, c.fin===null?MAX:c.fin);},0);
      })(),
      objetivoActual: cal.length?cal[0].objetivo:null,
      filas: cards.map(function(c){return {id:c.id,c:c.c,t:'card',fin:c.fin===null?MAX:c.fin};})
        .concat(loans.map(function(l){return {id:l.id,c:l.c,t:'loan',fin:l.fin===null?MAX:l.fin};}))
    };
  }

  // ============ RENDER: HOY ============
  function grupoVariable(){
    // el grupo donde se crean las categorías nuevas (gastos variables)
    return (st.grupos||[]).filter(function(g){return g.id==='var';})[0] || st.grupos[1] || st.grupos[0];
  }
  function grupoDeItem(id){
    for(var i=0;i<st.grupos.length;i++){
      if((st.grupos[i].items||[]).some(function(x){return x.id===id;})) return st.grupos[i];
    }
    return null;
  }
  function renderChips(){
    var h = el('chips'); h.innerHTML='';
    function chip(id, txt, cls){
      var b=document.createElement('button');
      b.className='chip'+(cls?' '+cls:''); b.type='button'; b.textContent=txt;
      b.setAttribute('aria-pressed', st.sel===id?'true':'false');
      b.addEventListener('click', function(){ st.sel=id; renderChips(); syncDesc(); el('amt').focus(); });
      h.appendChild(b);
    }
    todosItems().forEach(function(c){ chip(c.id, c.corto||c.nm); });
    // chip para gestionar categorías (agregar / editar / eliminar)
    var mas=document.createElement('button');
    mas.className='chip chip-mas'; mas.type='button'; mas.textContent='✎ categorías';
    mas.addEventListener('click', function(){ toggleGestorCat(); });
    h.appendChild(mas);
  }

  function toggleGestorCat(){
    var box=el('gestorCat');
    if(!box) return;
    box.hidden=!box.hidden;
    if(!box.hidden) renderGestorCat();
  }
  function renderGestorCat(){
    var box=el('gestorCat'); if(!box) return;
    var html='<div class="gc-title">Editá tus categorías</div>'+
      '<div class="gc-sub">Cambiá el nombre, borrá las que no uses, o agregá nuevas. Se conectan solas con la torta y el presupuesto.</div>';
    todosItems().forEach(function(c){
      html+='<div class="gc-row" data-id="'+c.id+'">'+
        '<input class="gc-nm" type="text" value="'+(c.corto||c.nm).replace(/"/g,'&quot;')+'" aria-label="Nombre">'+
        '<button class="gc-del" aria-label="Borrar '+(c.corto||c.nm)+'">×</button>'+
      '</div>';
    });
    html+='<div class="gc-add">'+
      '<input class="gc-newnm" type="text" placeholder="Nueva categoría">'+
      '<input class="gc-newmeta" type="text" inputmode="numeric" placeholder="Meta (opcional)">'+
      '<button class="gc-addbtn">Agregar</button>'+
    '</div>';
    box.innerHTML=html;

    // renombrar
    box.querySelectorAll('.gc-row').forEach(function(row){
      var id=row.getAttribute('data-id');
      var it=todosItems().filter(function(x){return x.id===id;})[0];
      var inp=row.querySelector('.gc-nm');
      inp.addEventListener('change', function(){
        var v=inp.value.trim()||'Sin nombre';
        it.nm=v; it.corto=v; renderAll(); guardar();
      });
      row.querySelector('.gc-del').addEventListener('click', function(){
        // no permitir borrar si tiene gastos este mes (para no perder registros)
        var tiene=(st.movs||[]).some(function(m){ return m.cat===id && m.tipo!=='deuda' && m.tipo!=='ahorro'; });
        if(tiene){
          if(!confirmInline(row, '¿Borrar "'+(it.corto||it.nm)+'"? Tiene gastos este mes que se moverán a Otros.')) return;
          // mover sus movimientos a 'otros'
          (st.movs||[]).forEach(function(m){ if(m.cat===id && m.tipo!=='deuda' && m.tipo!=='ahorro') m.cat='otros'; });
        }
        var g=grupoDeItem(id);
        if(g) g.items=g.items.filter(function(x){return x.id!==id;});
        if(st.sel===id) st.sel='otros';
        renderAll(); guardar(); renderGestorCat();
      });
    });
    // agregar
    var nn=box.querySelector('.gc-newnm'), nm2=box.querySelector('.gc-newmeta');
    function addCat(){
      var n=nn.value.trim(); if(!n){ nn.focus(); return; }
      var g=grupoVariable();
      var nuevoId='x'+Date.now();
      g.items.push({id:nuevoId, nm:n, corto:n, meta:pn(nm2.value)});
      nn.value=''; nm2.value='';
      st.sel=nuevoId; // seleccionar la nueva
      renderAll(); guardar(); renderGestorCat();
      setStatus('Categoría agregada.');
    }
    box.querySelector('.gc-addbtn').addEventListener('click', addCat);
    nn.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addCat(); } });
  }
  // confirmación inline simple (sin confirm nativo)
  function confirmInline(row, msg){
    return window.confirm(msg); // fallback simple; el usuario pidió inline pero esto evita borrados accidentales
  }

  function syncDesc(){
    var d=el('desc'), esOtros = st.sel==='otros';
  
    d.placeholder = esOtros ? '¿En qué fue? — anotalo o después no te vas a acordar' : '¿En qué fue? (opcional)';
    d.className = 'desc' + (esOtros?' req':'');
    el('addHint').textContent = esOtros
      ? 'En "Otros" el detalle es obligatorio: es la categoría que se vuelve un agujero negro.'
      : 'Se descuenta del saldo y de la categoría al instante.';
  }

  function renderCats(){
    var g=gastadoPorCat(), h=el('cats'); h.innerHTML='';
    var tm=0, tg=0;
    todosItems().forEach(function(c){
      if(c.meta===0 && !(g[c.id]>0)) return;
      var u=g[c.id]||0; tm+=c.meta; tg+=u;
      var pct = c.meta>0 ? Math.min(100,u/c.meta*100) : (u>0?100:0);
      var cls = u>c.meta ? 'over' : (u>c.meta*0.8?'mid':'');
      var d=document.createElement('div'); d.className='cat'; d.dataset.cat=c.id;
      d.innerHTML='<div class="cat-top"><span>'+c.nm+'</span><span class="vals"><b>'+gs(u)+'</b> / '+gs(c.meta)+
        (u>c.meta?' <span style="color:var(--brick)">+'+gs(u-c.meta)+'</span>':'')+'</span></div>'+
        '<div class="bar"><div class="'+cls+'" style="width:'+pct+'%"></div></div>';
      h.appendChild(d);
    });
    el('catSub').textContent='Gastaste '+gs(tg)+' de '+gs(totalMetas())+' presupuestados.';
    return {tm:totalMetas(), tg:tg, g:g};
  }

  function renderMovs(){
    var h=el('movs'); h.innerHTML='';
    if(!st.movs.length){ h.innerHTML='<div class="empty">Todavía no anotaste nada. El primer gasto arranca el conteo.</div>'; el('mvSub').textContent='—'; return; }
    var nm={}; todosItems().forEach(function(i){ nm[i.id]=i.nm; });
    var lista = st.movs.slice().reverse();

    function filaMov(v){
      var d=document.createElement('div'); d.className='mv';
      var falta = v.cat==='otros' && !v.d && v.tipo!=='deuda';
      var etiq = v.tipo==='deuda' ? nombreDeuda(v.cat)+' <span class="due late">pago</span>'
               : v.tipo==='ahorro' ? (v.d||'Ahorro')+' <span class="due soon">ahorro</span>'
               : (nm[v.cat]||'Otros');
      d.innerHTML='<div class="l">'+etiq+
        '<input class="nota" type="text" value="'+(v.d||'').replace(/"/g,'&quot;')+'" placeholder="'+(falta?'¿en qué fue?':'agregar detalle')+'" aria-label="Detalle">'+
        '<span>'+v.f+'</span></div>'+
        '<div class="r"><span class="amount">'+gs(v.monto)+'</span><button class="kill" aria-label="Borrar">×</button></div>';
      d.querySelector('.nota').addEventListener('change', function(e){ v.d=e.target.value.trim(); renderAll(); guardar(); });
      d.querySelector('.kill').addEventListener('click', function(){
        st.saldo += v.monto;
        if(v.tipo==='deuda') aplicarPagoDeuda(v.cat, v.monto, true);
        if(v.tipo==='ahorro' && v.ref){
          var g=(st.ahorros||[]).filter(function(x){return x.id===v.ref;})[0];
          if(g) g.guardado=Math.max(0, g.guardado - v.monto);
        }
        st.movs = st.movs.filter(function(x){return x!==v;});
        renderAll(); guardar();
      });
      return d;
    }

    // primeros 5
    lista.slice(0,5).forEach(function(v){ h.appendChild(filaMov(v)); });

    // resto en desplegable
    if(lista.length>5){
      var det=document.createElement('details'); det.className='mv-more';
      var sum=document.createElement('summary');
      sum.textContent='Ver los otros '+(lista.length-5)+' registros';
      det.appendChild(sum);
      lista.slice(5).forEach(function(v){ det.appendChild(filaMov(v)); });
      h.appendChild(det);
    }
    el('mvSub').textContent = st.movs.length + (st.movs.length===1?' gasto anotado.':' gastos anotados.');
  }

  function tildarPendiente(id, marcar){
    var t=(st.todos||[]).filter(function(x){ return x.id===id; })[0];
    if(!t) return;
    t.hecho=marcar;
    if(t.monto>0){
      var d2=new Date(), f2=d2.getDate()+'/'+(d2.getMonth()+1);
      // siempre limpiar movimientos previos de este pendiente (evita duplicados o restos)
      var teniaMov = st.movs.some(function(x){ return x.src===t.id; });
      st.movs=st.movs.filter(function(x){ return x.src!==t.id; });
      if(marcar){
        st.saldo=Math.max(0, st.saldo-t.monto);
        if(t.deuda){
          aplicarPagoDeuda(t.deuda, t.monto, false);
          st.movs.push({cat:t.deuda, tipo:'deuda', monto:t.monto, f:f2, src:t.id, d:t.nm});
        } else {
          st.movs.push({cat:(t.cat||'otros'), monto:t.monto, f:f2, src:t.id, d:t.nm});
        }
      } else {
        // destildar: devolver el saldo solo si antes había un movimiento aplicado
        if(teniaMov){
          st.saldo+=t.monto;
          if(t.deuda) aplicarPagoDeuda(t.deuda, t.monto, true);
        }
      }
    }
    renderAll(); guardar();
  }

  function renderTodos(){
    var h=el('todos'); h.innerHTML='';
    var lista=(st.todos||[]).slice().sort(function(a,b){
      if(a.hecho!==b.hecho) return a.hecho?1:-1;
      return a.f < b.f ? -1 : a.f > b.f ? 1 : 0;
    });

    if(!lista.length){
      h.innerHTML='<div class="empty">No queda nada pendiente. Agregá lo que se te vaya ocurriendo abajo.</div>';
    }

    lista.forEach(function(t){
      var d=diasHasta(t.f), etq, cls;
      if(t.hecho){ etq='hecho'; cls='soon'; }
      else if(d<0){ etq='vencido hace '+(-d)+(d===-1?' día':' días'); cls='late'; }
      else if(d===0){ etq='hoy'; cls='now'; }
      else if(d<=3){ etq='en '+d+(d===1?' día':' días'); cls='now'; }
      else { etq='en '+d+' días'; cls='soon'; }

      var row=document.createElement('div');
      row.className='todo-item'+(t.hecho?' hecho':'');
      row.innerHTML='<input type="checkbox"'+(t.hecho?' checked':'')+' aria-label="Marcar '+t.nm+' como hecho">'+
        '<div class="todo-body"><div class="todo-nm">'+t.nm+'</div>'+
        '<div class="todo-meta"><span class="due '+cls+'">'+etq+'</span>'+(t.nota||'')+'</div></div>'+
        (t.monto>0 || !t.hecho
          ? '<input class="todo-inp" type="text" inputmode="numeric" value="'+fmt.format(t.monto)+'" aria-label="Monto de '+t.nm+'">'
          : '')+
        '<button class="kill" aria-label="Borrar">×</button>';

      var chk=row.querySelector('input[type=checkbox]');
      chk.addEventListener('change', function(e){
        tildarPendiente(t.id, e.target.checked);
      });
      // tocar el nombre/cuerpo también alterna el tilde (área grande, fácil en móvil)
      var cuerpo=row.querySelector('.todo-body');
      if(cuerpo){
        cuerpo.style.cursor='pointer';
        cuerpo.addEventListener('click', function(){
          tildarPendiente(t.id, !t.hecho);
        });
      }
      var mi=row.querySelector('.todo-inp');
      if(mi) mi.addEventListener('change', function(){
        var nuevo=pn(mi.value), viejo=t.monto;
        t.monto=nuevo;
        if(t.id==='t15') t.editado=true;
        // si ya estaba tildado, rehacer el pago con el monto corregido
        if(t.hecho && nuevo!==viejo){
          var dif=nuevo-viejo; // cuánto más (o menos) se pagó
          st.saldo=Math.max(0, st.saldo-dif);
          // actualizar el movimiento existente
          st.movs.forEach(function(m){ if(m.src===t.id) m.monto=nuevo; });
          // ajustar la deuda si aplica
          if(t.deuda) aplicarPagoDeuda(t.deuda, dif, false);
        }
        renderAll(); guardar();
      });
      row.querySelector('.kill').addEventListener('click', function(){
        st.todos=st.todos.filter(function(x){return x!==t;}); renderAll(); guardar();
      });
      h.appendChild(row);
    });

    el('todoSum').textContent=gs(reservado());
    el('todoAll').textContent='Total pendiente, incluyendo lo del ciclo que viene: '+gs(pendiente());
  }

  function renderExtras(){
    var h=el('extras'); if(!h) return; h.innerHTML='';
    if(!(st.extras||[]).length){
      h.innerHTML='<div class="empty">Sin ingresos extra este mes. Si entra algo además del sueldo, agregalo abajo.</div>';
      return;
    }
    st.extras.forEach(function(r){
      var row=document.createElement('div'); row.className='erow'; row.style.gridTemplateColumns='1fr 110px 30px';
      row.innerHTML='<div><input class="txt" type="text" value="'+r.nm.replace(/"/g,'&quot;')+'" aria-label="Origen"></div>'+
        '<div><input class="money" type="text" inputmode="numeric" value="'+fmt.format(r.monto)+'" aria-label="Monto"></div>'+
        '<button class="kill" aria-label="Borrar">×</button>';
      var ins=row.querySelectorAll('input');
      ins[0].addEventListener('change', function(){ r.nm=ins[0].value.trim()||'Ingreso extra'; renderAll(); guardar(); });
      ins[1].addEventListener('change', function(){
        var nuevo=pn(ins[1].value), dif=nuevo-r.monto;
        r.monto=nuevo; st.saldo=Math.max(0, st.saldo+dif); // ajustar saldo por la diferencia
        renderAll(); guardar();
      });
      row.querySelector('.kill').addEventListener('click', function(){
        st.saldo=Math.max(0, st.saldo-r.monto); // al borrar, quitar del saldo
        st.extras=st.extras.filter(function(x){return x!==r;}); renderAll(); guardar();
      });
      h.appendChild(row);
    });
  }

  function renderHoy(res){
    var d=dias(), res_=reservado(), lib=st.saldo-res_, pd=lib/d;
    var cls = lib<0?'bad':pd<60000?'bad':pd<110000?'warn':'ok';
    el('hoy').textContent=gs(Math.max(0,pd)); el('hoy').className='big '+cls;
    el('kHoy').textContent=gs(Math.max(0,pd)); el('kHoy').className='v '+cls;
    el('kSaldo').textContent=gs(st.saldo);
    numVivo(el('hoy'), Math.round(Math.max(0,pd))); numVivo(el('kHoy'), Math.round(Math.max(0,pd))); numVivo(el('kSaldo'), Math.round(st.saldo));

    var fCobro = st.cobro ? new Date(st.cobro+'T00:00:00').getDate()+' de '+LARGO[new Date(st.cobro+'T00:00:00').getMonth()] : 'el próximo cobro';
    el('hoySub').textContent = lib<0
      ? 'No alcanza: te faltan '+gs(-lib)+' para cubrir lo que vence antes del '+fCobro+'.'
      : 'Repartido en los '+d+(d===1?' día':' días')+' que faltan hasta el '+fCobro+'.';

    var rPend=reservadoPend();
    el('bd').innerHTML =
      '<div><span>Saldo en cuenta</span><span class="num">'+gs(st.saldo)+'</span></div>'+
      (rPend>0?'<div><span>− Pagos pendientes antes del '+fCobro+'</span><span class="num">'+gs(rPend)+'</span></div>':'')+
      '<div class="tot"><span>= Libre para comida y varios</span><span class="num" style="color:'+(lib<0?'var(--brick)':'var(--moss)')+'">'+(lib<0?'−':'')+gs(Math.abs(lib))+'</span></div>';
    var m=el('meter');
    m.style.width=(res.tm>0?Math.min(100,res.tg/res.tm*100):0)+'%';
    m.className = res.tg>res.tm?'over':'';
    return pd;
  }

  function renderAdvice(res, pd){
    var res_=reservado(), lib=st.saldo-res_, a=el('advice'), peor=null, ex=0;
    todosItems().forEach(function(c){ var d=(res.g[c.id]||0)-c.meta; if(d>ex){ex=d;peor=c;} });
    var cls,t,b;
    if(lib<0){
      cls='bad'; t='Los pagos de este ciclo no entran en tu saldo';
      b='<p>Tenés '+gs(res_)+' comprometidos antes del próximo cobro y '+gs(st.saldo)+' en cuenta. Faltan <span class="big-inline">'+gs(-lib)+'</span>.</p>'+
        '<p>La prioridad es la deuda que esté en mora: cada mes que pasa suma punitorios y te baja la calificación crediticia, que no se recupera pagando después.</p>'+
        '<p>Para las cuotas de préstamos, llamá al banco y preguntá si tienen días de gracia. Un día de atraso en un préstamo al día cuesta mucho menos que otro mes de mora en una tarjeta.</p>';
    } else if(lib===0){
      cls='bad'; t='Estás justo en cero';
      b='<p>Todo tu saldo está comprometido. Cualquier gasto de acá al próximo cobro sale de una tarjeta, que es el mecanismo exacto que te trajo hasta acá.</p><p>Comida en casa y nafta solo lo indispensable.</p>';
    } else if(peor){
      cls='bad'; t=peor.nm+' se pasó';
      b='<p>Vas '+gs(ex)+' por encima de los '+gs(peor.meta)+' que te pusiste. Eso sale de otra categoría o del aporte a tarjetas.</p><p>'+
        (peor.id==='delivery'?'Cortá delivery el resto del mes: suele ser tu gasto más grande, es tu palanca principal.'
        :peor.id==='transf'?'Revisá qué transferencias son compromisos reales y cuáles podés postergar.'
        :peor.id==='compras'?'Compras es lo más fácil de congelar: nada que no se rompa hasta noviembre.'
        :'Compensá bajando delivery, que es donde más margen tenés.')+'</p>';
    } else if(pd<60000){
      cls='bad'; t='El día te queda muy corto';
      b='<p>Con '+gs(pd)+' por día no cubrís nafta y una comida afuera. Solo es viable cocinando en casa.</p><p>Si no llegás, bajá el aporte a tarjetas este mes en vez de volver a usar la tarjeta. Un plan que abandonás es peor que uno moderado.</p>';
    } else if(pd<110000){
      cls='warn'; t='Vas justo, pero llegás';
      b='<p>'+gs(pd)+' por día alcanza si el delivery queda para el fin de semana. Ojo con las cargas de nafta de 150.000: se comen día y medio cada una.</p>';
    } else {
      cls=''; t='Vas bien';
      b='<p>'+gs(pd)+' por día y ninguna categoría pasada. Si el mes cierra así, el excedente va directo a la tarjeta que estés atacando.</p><p>Lo que sobre no lo dejes en la cuenta: pasalo el mismo día.</p>';
    }
    a.className='card advice '+cls;
    a.innerHTML='<h3>'+t+'</h3>'+b;
  }

  // ============ RENDER: PRESUPUESTO ============
  function filaEditable(item, grupo){
    var gastadoReal = gastadoPorCat()[item.id] || 0;
    var r=document.createElement('div'); r.className='erow';
    r.innerHTML='<div><input class="txt" type="text" value="'+item.nm.replace(/"/g,'&quot;')+'" data-f="nm" aria-label="Nombre"></div>'+
      '<div class="real-live num" title="Lo que llevás gastado este mes (se actualiza solo)">'+gs(gastadoReal)+'</div>'+
      '<div><input class="money" type="text" inputmode="numeric" value="'+fmt.format(item.meta)+'" data-f="meta" aria-label="Meta"></div>'+
      '<button class="kill" aria-label="Borrar '+item.nm+'">×</button>';
    r.querySelectorAll('input').forEach(function(inp){
      inp.addEventListener('change', function(){
        if(inp.dataset.f==='nm'){ item.nm = inp.value.trim()||'Sin nombre'; item.corto=item.nm; }
        else item[inp.dataset.f]=pn(inp.value);
        renderAll(); guardar();
      });
    });
    r.querySelector('.kill').addEventListener('click', function(){
      grupo.items = grupo.items.filter(function(x){return x!==item;});
      renderAll(); guardar();
    });
    return r;
  }

  function renderPresu(){
    // encabezados de mes automáticos
    var mh=el('realHead1'); if(mh) mh.textContent=mesRefCap()+' real';
    var i=st.ing;
    el('usd').value=fmt.format(i.usd); el('tc').value=fmt.format(i.tc);
    el('fee').value=fmt.format(i.fee); el('retiros').value=fmt.format(i.retiros);
    el('extra').value=fmt.format(i.extra); el('ingTot').textContent=gs(ingreso());

    // puente del retiro único
    var ahorroAnual = i.fee * i.tc * 12;
    var puenteNec = Math.round(totalMetas()/2);
    var rend = puenteNec>0 ? ahorroAnual/puenteNec*100 : 0;
    el('puente').className='card verdict '+(i.retiros===1?'ok':'');
    el('puente').innerHTML = i.retiros===1
      ? '<h3>Estás en un retiro por mes</h3><p>Ahorrás <span class="big-inline">'+gs(ahorroAnual)+'</span> al año en comisiones. Para sostenerlo necesitás '+gs(puenteNec)+' de colchón: son los quince días que van desde que cobrás el primer pago hasta que retirás.</p>'
      : '<h3>Pasar a un retiro por mes</h3>'+
        '<p>Necesitás un puente de <span class="big-inline">'+gs(puenteNec)+'</span> — quince días de gastos, una sola vez — porque cobrás a principio de mes pero recién retirarías a mitad de mes.</p>'+
        '<p>A cambio ahorrás '+gs(ahorroAnual)+' por año. Es un rendimiento del '+rend.toFixed(0)+'% anual sobre ese capital: mejor que cancelar cualquiera de tus tarjetas.</p>'+
        '<p>Marcá la casilla del puente en la pestaña de deudas para ver cuánto atrasa el plan armarlo ya.</p>';

    var dh=el('deudaRows'); dh.innerHTML='';
    prestamos().map(function(m){
      var r=st.deudas[m.id]||0;
      return {nm:'Cuota '+m.nm, n:r+' cuotas', v:r>0?(m.cuota||0):0};
    }).concat([{nm:'Aporte a tarjetas', n:'lo movés en Deudas', v:st.aporte}]).forEach(function(d){
      var r=document.createElement('div'); r.className='erow';
      r.innerHTML='<div style="padding-left:8px">'+d.nm+'<div style="font-size:11.5px;color:var(--ink-soft)">'+d.n+'</div></div>'+
        '<div class="num" style="text-align:right;font-size:13px">—</div>'+
        '<div class="num" style="text-align:right;font-size:13px;font-weight:600">'+gs(d.v)+'</div><div class="locked">🔒</div>';
      dh.appendChild(r);
    });

    var gh=el('groups'); gh.innerHTML='';
    st.grupos.forEach(function(g){
      var tot=g.items.reduce(function(s,i){return s+i.meta;},0);
      var head=document.createElement('div'); head.className='grouphead';
      head.innerHTML='<h3>'+g.t+'</h3><span class="tot">'+gs(tot)+'</span>';
      gh.appendChild(head);
      var p=document.createElement('p'); p.className='sub-t'; p.style.margin='0 0 8px'; p.textContent=g.n; gh.appendChild(p);
      var c=document.createElement('div'); c.className='card';
      var rh=document.createElement('div'); rh.className='rowhead';
      rh.innerHTML='<span>Categoría</span><span>'+mesRefCap()+' real</span><span>Meta</span><span></span>';
      c.appendChild(rh);
      g.items.forEach(function(it){ c.appendChild(filaEditable(it,g)); });
      var ab=document.createElement('div'); ab.className='addbar';
      ab.innerHTML='<input class="nn" type="text" placeholder="Agregar a '+((g.t||g.nm||'grupo').toLowerCase())+'" aria-label="Nombre"><input class="na" type="text" inputmode="numeric" placeholder="Meta" aria-label="Monto"><button class="ghost">Agregar</button>';
      var nn=ab.querySelector('.nn'), na=ab.querySelector('.na');
      function add(){
        var n=nn.value.trim(); if(!n){ nn.focus(); return; }
        g.items.push({id:'x'+Date.now(), nm:n, corto:n, meta:pn(na.value)});
        renderAll(); guardar();
      }
      ab.querySelector('button').addEventListener('click', add);
      [nn,na].forEach(function(x){ x.addEventListener('keydown', function(e){ if(e.key==='Enter'){e.preventDefault();add();} }); });
      c.appendChild(ab); gh.appendChild(c);
    });

    // total general de gastos y verificación de que el plan cierre
    var totGastos=totalMetas();
    var ing=ingreso(), deuda=cuotasFijas()+st.aporte;
    var ahorro=(st.ahorros||[]).reduce(function(a,g){return a+g.aporte;},0);
    var sobra=ing-deuda-ahorro-totGastos;
    var box=document.createElement('div'); box.className='card gtot';
    box.innerHTML=
      '<div class="gtot-row"><span>Total de gastos del mes</span><span class="num">'+gs(totGastos)+'</span></div>'+
      '<div class="gtot-row small"><span>Ingreso menos deuda y ahorro, disponible para gastos</span><span class="num">'+gs(Math.max(0,ing-deuda-ahorro))+'</span></div>'+
      '<div class="gtot-row tot"><span>'+(sobra<0?'Te pasás por':'Te queda libre')+'</span>'+
        '<span class="num" style="color:'+(sobra<0?'var(--brick)':'var(--moss)')+'">'+(sobra<0?'−':'')+gs(Math.abs(sobra))+'</span></div>'+
      (sobra<0?'<div class="gtot-warn">El plan no cierra: estás gastando más de lo que entra. Bajá alguna meta o el aporte a tarjetas hasta que este número deje de ser rojo.</div>':'');
    gh.appendChild(box);
  }

  // ============ RENDER: DEUDAS ============
  function renderSaldosDeuda(sim){
    var meta={};
    DEUDAS_META.forEach(function(m){ meta[m.id]=m; });
    var objId = sim ? sim.objetivoActual : null;

    // cuánto se paga este mes a cada deuda, según la avalancha
    var pagoMes = (sim && sim.cal.length) ? sim.cal[0].p : {};
    var finMes={};
    if(sim) sim.filas.forEach(function(f){ finMes[f.id]=f.fin; });

    function etiquetaFin(id){
      var fin = finMes[id];
      if(fin===undefined || fin>=60) return '—';
      return nombreMes(fin, true);
    }

    // ---- FOCO: la deuda que se ataca ahora ----
    var foco=el('focoDeuda'); foco.innerHTML='';
    var mObj = objId ? meta[objId] : null;
    if(mObj){
      // usar el OBJETIVO CONGELADO del mes (no el recálculo de la simulación),
      // para que 'te falta' sea coherente aunque el saldo haya bajado por pagos
      var objetivoDelMes = (st.objetivoMes && st.objetivoMes.id===objId) ? st.objetivoMes.monto : (pagoMes[objId]||0);
      var yaPagado = (st.movs||[]).reduce(function(sum,m){ return sum + ((m.tipo==='deuda' && m.cat===objId)?m.monto:0); }, 0);
      var falta = Math.max(0, objetivoDelMes - yaPagado);
      var kFoco = yaPagado>0 ? 'Te falta este mes' : 'Le pagás este mes';
      var vFoco = yaPagado>0
        ? gs(falta)+'<div class="foco-sub2">ya pagaste '+gs(yaPagado)+' de '+gs(objetivoDelMes)+'</div>'
        : gs(objetivoDelMes);
      foco.innerHTML=
        '<div class="card foco">'+
          '<div class="foco-tag">Atacando ahora</div>'+
          '<div class="foco-nm">'+mObj.nm+'</div>'+
          '<div class="foco-saldo num">'+gs(saldoDe(mObj))+'</div>'+
          '<div class="foco-grid">'+
            '<div class="foco-box"><div class="foco-k">'+kFoco+'</div><div class="foco-v num">'+vFoco+'</div></div>'+
            '<div class="foco-box"><div class="foco-k">Queda libre en</div><div class="foco-v">'+etiquetaFin(objId)+'</div></div>'+
          '</div>'+
          '<div class="drow-grid" style="margin-top:12px">'+
            '<label>Saldo actual<input class="ff-sld" type="text" inputmode="numeric" value="'+fmt.format(st.deudas[objId]||0)+'"></label>'+
            '<label>Registrar un pago<input class="ff-abo" type="text" inputmode="numeric" placeholder="0"></label>'+
          '</div>'+
          '<div class="drow-act"><button class="ghost ff-pay">Aplicar pago</button></div>'+
          '<div class="drow-msg" hidden></div>'+
        '</div>';

      var fsld=foco.querySelector('.ff-sld');
      fsld.addEventListener('change', function(){ st.deudas[objId]=pn(fsld.value); renderAll(); guardar(); });
      var fabo=foco.querySelector('.ff-abo'), fmsg=foco.querySelector('.drow-msg');
      foco.querySelector('.ff-pay').addEventListener('click', function(){
        var v=pn(fabo.value);
        if(v<=0){ fmsg.textContent='Poné cuánto pagaste.'; fmsg.hidden=false; fabo.focus(); return; }
        if(v>st.saldo){ fmsg.textContent='No te alcanza: en la cuenta tenés '+gs(st.saldo)+'.'; fmsg.hidden=false; fabo.focus(); return; }
        fmsg.hidden=true;
        aplicarPagoDeuda(objId, v, false);
        st.saldo=Math.max(0, st.saldo-v);
        var d=new Date();
        st.movs.push({cat:objId, tipo:'deuda', monto:v, f:d.getDate()+'/'+(d.getMonth()+1), d:'Pago a '+mObj.nm});
        fabo.value=''; renderAll(); guardar();
        setStatus('Pago aplicado a '+mObj.nm+'.');
      });
      fabo.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); foco.querySelector('.ff-pay').click(); } });
    } else {
      foco.innerHTML = DEUDAS_META.length
        ? '<div class="card foco"><div class="foco-nm">Sin tarjetas activas</div>'+
          '<div class="drow-sub" style="margin-top:4px">No tenés tarjetas con saldo. Lo que sigue son las cuotas fijas de los préstamos.</div></div>'
        : '<div class="card foco"><div class="foco-nm">Todavía no cargaste deudas</div>'+
          '<div class="drow-sub" style="margin-top:4px">Agregá tus tarjetas y préstamos abajo, en «Editar tus deudas», o cargá tu perfil privado.</div></div>';
    }

    // ---- TARJETAS: todas las deudas ----
    var host=el('deudaCards'); host.innerHTML='';
    DEUDAS_META.forEach(function(m){
      if(m.id===objId) return; // ya está destacada arriba en el foco
      var val=st.deudas[m.id]||0, esPrest=m.tipo==='prestamo';
      var saldoGs=saldoDe(m), liquidada=val<=0;
      var esObjetivo = false;
      var pago = pagoMes[m.id]||0;
      var tot = esPrest ? m.total : m.saldoInicial;
      var pct = liquidada ? 100 : (tot>0 ? Math.min(100, Math.max(2,(1-saldoGs/tot)*100)) : 0);
      var barBg = esPrest ? 'var(--ok-l)' : 'var(--warn-l)';

      var c=document.createElement('div'); c.className='card drow'+(esObjetivo?' drow-foco':'');
      c.innerHTML=
        '<div class="drow-top"><div><div class="drow-nm">'+m.nm+(esObjetivo?' <span class="mini-tag">activa</span>':'')+'</div>'+
          '<div class="drow-sub">'+m.detalle+'</div></div>'+
          (liquidada?'<span class="flag on">liquidada</span>':'')+'</div>'+
        (liquidada?'':
          '<div class="drow-progress"><div style="width:'+pct+'%;background:'+barBg+'"></div></div>'+
          '<div class="drow-meta">'+
            '<span>'+(esPrest?'Cuota fija':(esObjetivo?'Le pagás':'Mínimo'))+' <b class="num">'+gs(pago||(esPrest?(m.cuota||0):(m.minimo||0)))+'</b>/mes</span>'+
            '<span>Libre en <b>'+etiquetaFin(m.id)+'</b></span>'+
          '</div>')+
        '<div class="drow-grid">'+
          '<label>'+(esPrest?'Cuotas que faltan':'Saldo actual')+
            '<input class="f-sld" type="text" inputmode="numeric" value="'+fmt.format(val)+'"></label>'+
          '<label>Registrar un pago<input class="f-abo" type="text" inputmode="numeric" placeholder="0"></label>'+
        '</div>'+
        '<div class="drow-act"><button class="ghost f-pay">Aplicar pago</button></div>'+
        '<div class="drow-msg" hidden></div>';

      var sld=c.querySelector('.f-sld');
      sld.addEventListener('change', function(){ st.deudas[m.id]=pn(sld.value); renderAll(); guardar(); });

      var abo=c.querySelector('.f-abo'), msg=c.querySelector('.drow-msg');
      function aviso(t){ msg.textContent=t; msg.hidden=!t; }
      function pagar(){
        var v=pn(abo.value);
        if(v<=0){ aviso('Poné cuánto pagaste.'); abo.focus(); return; }
        if(v>st.saldo){ aviso('No te alcanza: en la cuenta tenés '+gs(st.saldo)+'. Si el pago salió de otro lado, corregí el saldo de arriba en vez de usar esto.'); abo.focus(); return; }
        aviso('');
        aplicarPagoDeuda(m.id, v, false);
        st.saldo=Math.max(0, st.saldo-v);
        var d=new Date();
        st.movs.push({cat:m.id, tipo:'deuda', monto:v, f:d.getDate()+'/'+(d.getMonth()+1), d:'Pago a '+m.nm});
        abo.value=''; renderAll(); guardar();
        setStatus('Pago aplicado a '+m.nm+'.');
      }
      c.querySelector('.f-pay').addEventListener('click', pagar);
      abo.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); pagar(); } });

      host.appendChild(c);
    });
  }

  function renderDeudas(){
    el('aporte').value=st.aporte;
    el('aporteVal').textContent='Gs. '+gs(st.aporte);
    el('puenteChk').checked=st.puente;

    var sim=simular();
    renderSaldosDeuda(sim);
    el('kZero').textContent = sim.meses>=60 ? '+5 años' : nombreMes(sim.meses-1,false)+' '+String(ANIO0+Math.floor((MES0+sim.meses-1)/12)).slice(2);

    // timeline
    var total=Math.max(sim.meses,12), h=el('timeline'); h.innerHTML='';
    sim.filas.forEach(function(f){
      var row=document.createElement('div'); row.className='tl-row';
      var fin = f.fin>=total ? '—' : nombreMes(f.fin,false)+' '+String(ANIO0+Math.floor((MES0+f.fin)/12)).slice(2);
      var bars='';
      for(var k=0;k<total;k++){
        bars += '<div class="cell'+(k<f.fin?' on'+(f.t==='loan'?' loan':''):(k===f.fin?' last':''))+'"></div>';
      }
      row.innerHTML='<div class="tl-name">'+f.c+'<span>'+fin+'</span></div><div class="tl-bars">'+bars+'</div>';
      h.appendChild(row);
    });

    // calendario
    // columnas: las deudas que reciben algún pago en los meses que se muestran
    var cols=DEUDAS_META.filter(function(m){
      return sim.cal.slice(0,10).some(function(f){ return (f.p[m.id]||0)>0; });
    }).map(function(m){ return m.id; });
    el('schedHead').innerHTML='<th>Mes</th>'+cols.map(function(id){ return '<th>'+(deudaPorId(id).corto||deudaPorId(id).nm)+'</th>'; }).join('')+'<th>Total</th>';
    var b=el('schedBody'); b.innerHTML='';
    sim.cal.slice(0,10).forEach(function(f){
      var t=cols.reduce(function(s,k){return s+(f.p[k]||0);},0);
      var cel=cols.map(function(k){ var v=f.p[k]||0; return '<td'+(v?'':' style="color:var(--rule)"')+'>'+(v?gs(v):'—')+'</td>'; }).join('');
      b.insertAdjacentHTML('beforeend','<tr><td style="text-transform:capitalize">'+nombreMes(f.m,false)+' '+String(ANIO0+Math.floor((MES0+f.m)/12)).slice(2)+
        (f.cierra.length?'<span class="flag on">✓ '+f.cierra.join(' + ')+'</span>':'')+'</td>'+cel+'<td style="font-weight:600">'+gs(t)+'</td></tr>');
    });
    var resto=sim.cal.length-Math.min(10,sim.cal.length);
    var ultima = sim.filas.slice().sort(function(a,b){ return b.fin-a.fin; })[0];
    el('schedNote').textContent = resto>0 ? 'Faltan '+resto+' meses más, iguales al último, hasta cerrar '+(ultima?ultima.c:'la última deuda')+'.' : 'Ese es el calendario completo hasta deuda cero.';

    var v=el('deudaVerdict');
    var tarjetasVivas = sim.finTar>=0;
    v.className='card verdict '+((!tarjetasVivas||sim.finTar<60)?'ok':'bad');
    var titulo = !DEUDAS_META.length
      ? 'Todavía no cargaste deudas'
      : !tarjetasVivas
      ? 'Ya no tenés tarjetas con saldo'
      : (sim.finTar>=60
          ? 'Con este aporte las tarjetas tardan más de 5 años — subilo para acelerar'
          : 'Liquidás las tarjetas en '+nombreMes(sim.finTar,true));
    v.innerHTML='<h3>'+titulo+'</h3>'+
      '<p>Pagás <span class="big-inline">'+gs(sim.interes)+'</span> de intereses y cargos en total hasta llegar a cero.</p>'+
      (function(){
        var conTasa=prestamos().filter(function(m){ return (m.tasa||0)>0 && (st.deudas[m.id]||0)>0; });
        if(!conTasa.length) return '';
        var rec=conTasa.filter(function(m){ return m.recalc; }), sin=conTasa.filter(function(m){ return !m.recalc; });
        var nombres=function(l){ return l.map(function(m){ return m.nm; }).join(' y '); };
        return (rec.length?'<p>Estás asumiendo que el banco recalcula intereses al precancelar '+nombres(rec)+'. Confirmalo antes de contar con esa fecha.</p>':'')+
               (sin.length?'<p>Sin recálculo de intereses en '+nombres(sin)+', adelantar cuotas del préstamo no te ahorra plata: el plan solo ataca las tarjetas.</p>':'');
      })();
    return sim;
  }

  // ============ EDITOR DE DEUDAS ============
  var pPct = function(v){ var n=parseFloat(String(v).replace(/[^\d,.-]/g,'').replace(',','.')); return isNaN(n)?0:n/100; };
  var fPct = function(t){ return String(Math.round((t||0)*10000)/100).replace('.',','); };
  var esc = function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); };

  function cambioDeudas(){ PERFIL.demo=false; renderAll(); guardar(); }

  function borrarDeuda(id){
    PERFIL.deudas = PERFIL.deudas.filter(function(m){ return m.id!==id; });
    DEUDAS_META = PERFIL.deudas;
    delete st.deudas[id];
    // los pendientes que pagaban esa deuda quedan como pendientes comunes
    (st.todos||[]).forEach(function(t){ if(t.deuda===id) delete t.deuda; });
    if(st.objetivoMes && st.objetivoMes.id===id) st.objetivoMes=null;
    cambioDeudas();
  }

  function renderEditorDeudas(){
    var host=el('deudaEditor'); host.innerHTML='';
    if(!DEUDAS_META.length){
      host.innerHTML='<div class="card empty">Todavía no hay deudas. Agregá la primera abajo.</div>';
      return;
    }
    DEUDAS_META.forEach(function(m){
      var prest=esPrestamo(m);
      var campo=function(lbl, f, val, ayuda){
        return '<label>'+lbl+(ayuda?' <span style="font-weight:400">· '+ayuda+'</span>':'')+
               '<input type="text" inputmode="decimal" data-f="'+f+'" value="'+esc(val)+'"></label>';
      };
      var c=document.createElement('div'); c.className='card drow';
      c.innerHTML=
        '<div class="drow-top"><div style="flex:1;min-width:0">'+
          '<input class="txt" type="text" data-f="nm" value="'+esc(m.nm)+'" aria-label="Nombre de la deuda" style="font-weight:600;width:100%">'+
          '<div class="drow-sub">'+(prest?'Préstamo':'Tarjeta')+'</div></div>'+
          '<button class="ghost danger" data-del style="flex:none">Borrar</button></div>'+
        '<div class="drow-grid">'+
          '<label>Nombre corto<input type="text" data-f="corto" value="'+esc(m.corto||'')+'" style="text-align:left;font-family:var(--body);font-weight:500"></label>'+
          '<label>Detalle<input type="text" data-f="detalle" value="'+esc(m.detalle||'')+'" style="text-align:left;font-family:var(--body);font-weight:500"></label>'+
          (prest
            ? campo('Cuotas que faltan','saldo',fmt.format(st.deudas[m.id]||0))+
              campo('Cuota mensual','cuota',fmt.format(m.cuota||0))+
              campo('Total original','total',fmt.format(m.total||0),'para la barra')+
              campo('Tasa anual %','tasa',fPct(m.tasa),'0 si no la sabés')
            : campo('Saldo actual','saldo',fmt.format(st.deudas[m.id]||0))+
              campo('Tasa anual %','tasa',fPct(m.tasa))+
              campo('Pago mínimo','minimo',fmt.format(m.minimo||0))+
              campo('Cargos fijos por mes','cargo',fmt.format(m.cargo||0),'seguro, mantenimiento')+
              campo('Saldo al empezar','saldoInicial',fmt.format(m.saldoInicial||0),'para la barra'))+
          (prest && m.recalc ? campo('Capital pendiente','capital',fmt.format(m.capital||0)) : '')+
        '</div>'+
        (prest ? '<label class="toggle"><input type="checkbox" data-f="recalc"'+(m.recalc?' checked':'')+'><span>El banco recalcula intereses si precancelo — preguntá antes de marcarlo</span></label>' : '');

      c.querySelectorAll('input[data-f]').forEach(function(inp){
        inp.addEventListener('change', function(){
          var f=inp.dataset.f;
          if(f==='nm'){ m.nm=inp.value.trim()||'Deuda'; }
          else if(f==='corto' || f==='detalle'){ m[f]=inp.value.trim(); }
          else if(f==='recalc'){ m.recalc=inp.checked; }
          else if(f==='tasa'){ m.tasa=pPct(inp.value); }
          else if(f==='saldo'){ st.deudas[m.id]=pn(inp.value); }
          else { m[f]=pn(inp.value); }
          if(!m.corto) m.corto=m.nm;
          cambioDeudas();
        });
      });
      var del=c.querySelector('[data-del]');
      del.addEventListener('click', function(){
        // dos toques para borrar, sin ventanas emergentes
        if(!del.dataset.ok){ del.dataset.ok='1'; del.textContent='¿Seguro? Tocá de nuevo'; return; }
        borrarDeuda(m.id);
        setStatus('Deuda borrada.');
      });
      host.appendChild(c);
    });
  }

  function addDeuda(){
    var n=el('dNm').value.trim(); if(!n){ el('dNm').focus(); return; }
    var tipo=el('dTipo').value==='prestamo'?'prestamo':'tarjeta';
    var m = tipo==='prestamo'
      ? {id:'d'+Date.now(), nm:n, corto:n, tipo:'prestamo', cuota:0, total:0, tasa:0, capital:0, recalc:false, detalle:'Préstamo · cuota fija', patrones:[]}
      : {id:'d'+Date.now(), nm:n, corto:n, tipo:'tarjeta', tasa:0, cargo:0, minimo:0, saldoInicial:0, detalle:'Tarjeta', patrones:[]};
    PERFIL.deudas.push(m);
    st.deudas[m.id]=0;
    el('dNm').value='';
    cambioDeudas();
    setStatus('Deuda agregada. Completá saldo, tasa y mínimo.');
  }

  // ============ AHORRO ============
  function mesesEntre(a,b){
    var d1=new Date(a+'T00:00:00'), d2=new Date(b+'T00:00:00');
    return Math.max(1, (d2.getFullYear()-d1.getFullYear())*12 + (d2.getMonth()-d1.getMonth()));
  }
  function mesLargo(off){
    var h=new Date(), i=(h.getMonth()+off)%12, a=h.getFullYear()+Math.floor((h.getMonth()+off)/12);
    return LARGO[i]+' '+a;
  }

  function renderAhorro(){
    var host=el('ahorroList'); host.innerHTML='';
    var hoyISO=new Date().toISOString().slice(0,10);
    var totObj=0, totGuard=0, totAporte=0;

    (st.ahorros||[]).forEach(function(g){
      totObj+=g.obj; totGuard+=g.guardado; totAporte+=g.aporte;
      var falta=Math.max(0, g.obj-g.guardado);
      var pct=g.obj>0 ? Math.min(100, g.guardado/g.obj*100) : 0;
      var meses = g.aporte>0 ? Math.ceil(falta/g.aporte) : 0;
      var necesario = Math.ceil(falta/mesesEntre(hoyISO,g.fecha)/5000)*5000;

      var porMes = falta<=0 ? 0 : Math.ceil(falta/mesesEntre(hoyISO,g.fecha)/5000)*5000;
      var c=document.createElement('div'); c.className='card goalB';
      c.innerHTML=
        '<div class="gb-top">'+
          '<input class="gb-nm" type="text" value="'+g.nm.replace(/"/g,'&quot;')+'" aria-label="Nombre de la meta">'+
          '<button class="gb-del" aria-label="Borrar meta">×</button>'+
        '</div>'+
        (g.nota?'<div class="gb-nota">'+g.nota+'</div>':'')+
        '<div class="gb-boxes">'+
          '<div class="gb-box"><div class="gb-k">Te falta</div><div class="gb-v num">'+(falta<=0?'¡Listo!':gs(falta))+'</div></div>'+
          '<div class="gb-box"><div class="gb-k">Por mes</div><div class="gb-v num">'+(falta<=0?'—':gs(porMes))+'</div></div>'+
        '</div>'+
        '<div class="gb-bar"><div style="width:'+pct+'%"></div></div>'+
        '<div class="gb-nums"><span>Llevás <b>'+gs(g.guardado)+'</b></span><span>de '+gs(g.obj)+' ('+pct.toFixed(0)+'%)</span></div>'+
        '<div class="gb-edit">'+
          '<label>Objetivo<input class="gb-obj" type="text" inputmode="numeric" value="'+fmt.format(g.obj)+'"></label>'+
          '<label>Para cuándo<input class="gb-fecha date" type="date" value="'+g.fecha+'"></label>'+
        '</div>'+
        '<div class="gb-add">'+
          '<input class="gb-inp" type="text" inputmode="numeric" placeholder="Aporté...">'+
          '<button class="gb-sumar">Sumar</button>'+
        '</div>';

      // nombre editable
      c.querySelector('.gb-nm').addEventListener('change', function(e){ g.nm=e.target.value.trim()||'Meta'; renderAll(); guardar(); });
      // objetivo editable
      c.querySelector('.gb-obj').addEventListener('change', function(e){ g.obj=pn(e.target.value); renderAll(); guardar(); });
      // fecha editable
      c.querySelector('.gb-fecha').addEventListener('change', function(e){ g.fecha=e.target.value; renderAll(); guardar(); });
      // sumar aporte
      var inp=c.querySelector('.gb-inp');
      function sumar(){
        var v=pn(inp.value); if(v<=0){ inp.focus(); return; }
        g.guardado+=v; st.saldo=Math.max(0, st.saldo-v);
        var dd=new Date();
        st.movs.push({cat:g.id, tipo:'ahorro', ref:g.id, monto:v, f:dd.getDate()+'/'+(dd.getMonth()+1), d:g.nm});
        inp.value=''; renderAll(); guardar();
        setStatus('Aporte registrado.');
      }
      c.querySelector('.gb-sumar').addEventListener('click', sumar);
      inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); sumar(); } });
      // borrar meta
      c.querySelector('.gb-del').addEventListener('click', function(){
        st.ahorros=st.ahorros.filter(function(x){return x!==g;}); renderAll(); guardar();
      });

      host.appendChild(c);
    });

    if(!(st.ahorros||[]).length){
      host.innerHTML='<div class="card empty">Sin metas todavía. Agregá una abajo.</div>';
    }

    var v=el('ahorroVerdict');
    var faltaTot = Math.max(0, totObj-totGuard);
    v.className='card verdict ok';
    v.innerHTML='<h3>Tus metas de ahorro</h3>'+
      '<p>Llevás <span class="big-inline">'+gs(totGuard)+'</span> acumulados de '+gs(totObj)+' entre todas las metas. Te falta '+gs(faltaTot)+'.</p>'+
      '<p>Cada aporte que sumás se descuenta de tu saldo y queda guardado acá. Mientras tengas tarjetas caras abiertas, pensá si ese dinero no rinde más cancelando deuda primero.</p>';
  }

  function renderObjetivos(){
    var ing=ingreso();
    var objDeuda=cuotasFijas()+st.aporte;
    var objAhorro=(st.ahorros||[]).reduce(function(a,g){return a+g.aporte;},0);
    var objGasto=totalMetas();
    var hDeuda=sumaTipo('deuda'), hAhorro=sumaTipo('ahorro');
    var hGasto=st.movs.filter(esGasto).reduce(function(a,v){return a+v.monto;},0);
    var sinAsignar=ing-objDeuda-objAhorro-objGasto;

    var filas=[
      {n:'Deudas', o:objDeuda, h:hDeuda, c:'var(--brick)',
       nota:'Cuotas fijas '+gs(cuotasFijas())+' + aporte a tarjetas '+gs(st.aporte)},
      {n:'Ahorro', o:objAhorro, h:hAhorro, c:'var(--moss)',
       nota:objAhorro?'Repartido entre tus metas':'Todavía no asignaste aportes'},
      {n:'Gastos', o:objGasto, h:hGasto, c:'var(--mustard)',
       nota:'Suma de las metas por categoría'}
    ];

    el('objetivos').innerHTML='<div class="obj">'+filas.map(function(f){
      var pct=f.o>0?Math.min(100,f.h/f.o*100):0;
      var pasado=f.h>f.o && f.o>0;
      var falta=Math.max(0,f.o-f.h);
      return '<div class="obj-row"><div class="obj-top"><span class="n">'+f.n+'</span>'+
        '<span class="v"><b>'+gs(f.h)+'</b> de '+gs(f.o)+'</span></div>'+
        '<div class="obj-bar"><div style="width:'+pct+'%;background:'+(pasado?'var(--brick)':f.c)+'"></div></div>'+
        '<div class="obj-note">'+(pasado?'Te pasaste '+gs(f.h-f.o)+'. ':(f.n==='Gastos'?'Te quedan '+gs(falta)+' para gastar. ':'Falta '+gs(falta)+'. '))+f.nota+'</div></div>';
    }).join('')+'</div>'+
    '<div class="obj-sum"><span>Ingreso del mes</span><span>'+gs(ing)+'</span>'+
    '<span>Asignado</span><span>'+gs(objDeuda+objAhorro+objGasto)+'</span>'+
    '<span>Sin asignar</span><span style="color:'+(sinAsignar<0?'var(--brick)':'var(--moss)')+'">'+(sinAsignar<0?'−':'')+gs(Math.abs(sinAsignar))+'</span></div>';
  }

  // ============ GRÁFICOS ============
  var PALETA=['#B8412C','#2E6A4E','#C58F1E','#7A5C8E','#3D6E8F','#A0623A','#8C9A5B','#B5766A','#4A7C7E','#9C6B4F','#5C665F'];

  function donut(datos, total){
    var R=56, GR=17, C=2*Math.PI*R, off=0, segs='';
    var sep = datos.length>1 ? 2.2 : 0;
    datos.forEach(function(d,i){
      var bruto = total>0 ? d.v/total*C : 0;
      var len = Math.max(1, bruto - sep);
      // dirección hacia afuera del centro de la porción, para "levantarla" al seleccionarla
      var ang = (off + len/2) / R, dx=(Math.cos(ang)*5).toFixed(2), dy=(Math.sin(ang)*5).toFixed(2);
      segs+='<circle class="seg" data-i="'+i+'" cx="72" cy="72" r="'+R+'" fill="none" stroke="'+PALETA[i%PALETA.length]+'" stroke-width="'+GR+'"'+
            ' stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'"'+
            ' style="--dx:'+dx+'px;--dy:'+dy+'px"><title>'+esc(d.nm)+': '+gs(d.v)+'</title></circle>';
      off+=bruto;
    });
    return '<svg class="chart-svg" viewBox="0 0 144 144" width="172" height="172" role="img" aria-label="Gasto por categoría">'+
      '<g transform="rotate(-90 72 72)">'+
      '<circle cx="72" cy="72" r="'+R+'" fill="none" stroke="#E9EBE4" stroke-width="'+GR+'"></circle>'+segs+'</g>'+
      '<text class="t1" x="72" y="68">'+gs(total)+'</text>'+
      '<text class="t2" x="72" y="81">GASTADO</text>'+
      '<text class="t3" x="72" y="93"></text></svg>';
  }

  // selección de la torta: sobrevive a los re-render (se guarda el nombre, no el elemento)
  var tortaSel=null, tortaHover=null, TORTA={datos:[], total:0, porCat:{}};

  function marcarTorta(){
    var host=el('torta'), activo = tortaHover!==null ? tortaHover : tortaSel;
    var i = activo===null ? -1 : TORTA.datos.map(function(d){return d.nm;}).indexOf(activo);
    host.classList.toggle('con-sel', i>=0);
    host.querySelectorAll('[data-i]').forEach(function(e){ e.classList.toggle('on', +e.dataset.i===i); });
    var t1=host.querySelector('text.t1'), t2=host.querySelector('text.t2'), t3=host.querySelector('text.t3');
    if(t1){
      if(i>=0){
        var d=TORTA.datos[i], nm=d.nm.length>16 ? d.nm.slice(0,15)+'…' : d.nm;
        t1.textContent=gs(d.v); t2.textContent=nm.toUpperCase();
        t3.textContent=Math.round(d.v/TORTA.total*100)+'% del gasto';
      } else {
        t1.textContent=gs(TORTA.total); t2.textContent='GASTADO'; t3.textContent='';
      }
    }
    // resaltar también la categoría en la lista de abajo
    el('cats').querySelectorAll('.cat[data-cat]').forEach(function(c){
      c.classList.toggle('on', i>=0 && TORTA.porCat[c.dataset.cat]===i);
    });
  }
  function indiceDe(e){
    var x=e.closest('[data-i],.cat[data-cat]'); if(!x) return null;
    if(x.dataset.i!==undefined) return +x.dataset.i;
    var i=TORTA.porCat[x.dataset.cat]; return i===undefined ? null : i;
  }
  function conectarTorta(host){
    if(host._conectada) return; host._conectada=true;
    host.addEventListener('mouseover', function(e){ var i=indiceDe(e.target); tortaHover = i===null ? null : TORTA.datos[i].nm; marcarTorta(); });
    host.addEventListener('mouseleave', function(){ tortaHover=null; marcarTorta(); });
    host.addEventListener('keydown', function(e){ if((e.key==='Enter'||e.key===' ') && e.target.closest('[data-i]')){ e.preventDefault(); e.target.click(); } });
    host.addEventListener('click', function(e){
      var i=indiceDe(e.target), nm = i===null ? null : TORTA.datos[i].nm;
      tortaSel = (nm===null || nm===tortaSel) ? null : nm; // otro clic en la misma la suelta
      tortaHover=null; marcarTorta();
    });
  }

  function renderTorta(g){
    var todos=todosItems().map(function(c){ return {id:c.id, nm:c.nm, v:g[c.id]||0}; })
                          .filter(function(d){ return d.v>0; })
                          .sort(function(a,b){ return b.v-a.v; });
    var total=todos.reduce(function(a,d){return a+d.v;},0);
    var host=el('torta');
    if(!todos.length){
      host.innerHTML='<div class="empty">Cuando anotes tu primer gasto, acá vas a ver en qué se te va la plata.</div>';
      TORTA={datos:[], total:0, porCat:{}};
      return;
    }
    // con más de 8 gajos el gráfico se vuelve ilegible: agrupamos la cola
    var datos=todos, porCat={};
    if(todos.length>8){
      var cola=todos.slice(7).reduce(function(a,d){return a+d.v;},0);
      datos=todos.slice(0,7).concat([{nm:'Resto ('+(todos.length-7)+' categorías)', v:cola}]);
      todos.slice(7).forEach(function(d){ porCat[d.id]=7; });
    }
    todos.slice(0, datos.length===todos.length ? todos.length : 7).forEach(function(d,i){ porCat[d.id]=i; });
    TORTA={datos:datos, total:total, porCat:porCat};
    if(tortaSel!==null && !datos.some(function(d){ return d.nm===tortaSel; })) tortaSel=null;

    host.innerHTML='<div class="chart-wrap">'+donut(datos,total)+
      '<div class="chart-key">'+datos.map(function(d,i){
        return '<div data-i="'+i+'" role="button" tabindex="0"><i style="background:'+PALETA[i%PALETA.length]+'"></i><span class="nm">'+esc(d.nm)+'</span>'+
               '<span class="vl">'+gs(d.v)+'</span><span class="pc">'+Math.round(d.v/total*100)+'%</span></div>';
      }).join('')+'</div></div>';
    conectarTorta(host);
    conectarTorta(el('cats'));
    marcarTorta();
  }

  function renderBarras(){
    var g=gastadoPorCat(), host=el('barras');
    var datos=todosItems().filter(function(c){ return c.meta>0 || (g[c.id]||0)>0; })
      .map(function(c){ return {nm:c.nm, real:g[c.id]||0, meta:c.meta}; })
      .sort(function(a,b){ return (b.real-b.meta)-(a.real-a.meta); });
    if(!datos.length){ host.innerHTML='<div class="empty">Sin datos todavía.</div>'; return; }
    var tope=Math.max.apply(null, datos.map(function(d){ return Math.max(d.real,d.meta); }))||1;
    host.innerHTML='<div class="bars">'+datos.map(function(d){
      var pr=d.real/tope*100, pm=d.meta/tope*100, over=d.real>d.meta;
      return '<div class="brow"><div class="brow-top"><span class="n">'+d.nm+'</span>'+
        '<span class="v">'+gs(d.real)+' / '+gs(d.meta)+'</span></div>'+
        '<div class="btrack"><div class="bfill'+(over?' over':'')+'" style="width:'+pr+'%"></div>'+
        (d.meta>0?'<div class="bmark" style="left:'+pm+'%" title="meta"></div>':'')+'</div></div>';
    }).join('')+'</div>';
  }

  function renderHist(){
    var host=el('histList'); if(!host) return;
    var h=st.hist||[];
    if(!h.length){
      host.innerHTML='<div class="card empty">Todavía no hay meses cerrados. Cuando cierres tu primer ciclo, la foto va a aparecer acá.</div>';
      return;
    }
    host.innerHTML=h.map(function(m){
      // comparación presupuesto vs gasto real
      var tienePpto = m.presupuestado!==undefined && m.presupuestado>0;
      var dif = tienePpto ? m.gastos - m.presupuestado : 0;
      var vsPpto = '';
      if(tienePpto){
        if(dif>0)      vsPpto='<div class="hist-vs bad">Te pasaste '+gs(dif)+'</div>';
        else if(dif<0) vsPpto='<div class="hist-vs ok">Te sobró '+gs(-dif)+'</div>';
        else           vsPpto='<div class="hist-vs">Justo en el presupuesto</div>';
      }
      return '<div class="card" style="padding:14px 16px;margin-bottom:11px">'+
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px">'+
          '<span style="font-family:var(--display);font-size:15px;font-weight:600;text-transform:capitalize">'+m.etiqueta+'</span>'+
          '<span class="drow-sub">cerrado '+m.cerrado+'</span></div>'+
        (tienePpto?'<div class="hist-ppto"><div class="hist-ppto-row"><span>Presupuestaste</span><span class="num">'+gs(m.presupuestado)+'</span></div>'+
          '<div class="hist-ppto-row"><span>Gastaste</span><span class="num">'+gs(m.gastos)+'</span></div></div>'+vsPpto:'')+
        '<div class="hist-grid" style="margin-top:11px">'+
          (m.ingreso!==undefined?'<div><div class="hist-k">Ingresó</div><div class="hist-v num">'+gs(m.ingreso)+'</div></div>':'')+
          (!tienePpto?'<div><div class="hist-k">Gastaste</div><div class="hist-v num">'+gs(m.gastos)+'</div></div>':'')+
          '<div><div class="hist-k">Pagaste de deuda</div><div class="hist-v num">'+gs(m.pagosDeuda)+'</div></div>'+
          '<div><div class="hist-k">Ahorraste</div><div class="hist-v num">'+gs(m.ahorro||0)+'</div></div>'+
        '</div>'+
        // bloque de deuda: cómo empezó, cómo cerró, cuánto bajó
        (m.deudaInicial ?
          '<div class="hist-deuda"><div class="hist-ppto-row"><span>Deuda al empezar</span><span class="num">'+gs(m.deudaInicial)+'</span></div>'+
          '<div class="hist-ppto-row"><span>Deuda al cerrar</span><span class="num">'+gs(m.deudaTotal)+'</span></div>'+
          (function(){ var baj=m.deudaInicial-m.deudaTotal;
            if(baj>0) return '<div class="hist-vs ok">Bajaste la deuda '+gs(baj)+'</div>';
            if(baj<0) return '<div class="hist-vs bad">La deuda subió '+gs(-baj)+'</div>';
            return '<div class="hist-vs">La deuda quedó igual</div>'; })()+
          '</div>'
          :
          '<div class="hist-grid"><div><div class="hist-k">Deuda al cerrar</div><div class="hist-v num">'+gs(m.deudaTotal)+'</div></div></div>'
        )+
        '</div>';
    }).join('');
  }

  // ============ ANIMACIONES ============
  // Solo decorativas: si el dispositivo pide reducir movimiento, no se anima nada.
  var MOV = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var easeOut = function(t){ return 1-Math.pow(1-t,3); };

  // Lleva el número que muestra un elemento de 'desde' a 'hasta'. Si un render cambia
  // el texto en el medio, la animación se corta y queda el valor nuevo.
  function tweenNum(e, desde, hasta, ms){
    if(!MOV || !e || e===_noop || document.hidden) return;
    var fin=e.textContent, m=fin.match(/^(Gs\. |−|-)?([\d.]+)$/);
    if(!m || desde===hasta) return;
    var pre=m[1]||'', t0=null, id={}, ultimo=null;
    e._tw=id;
    function paso(ts){
      if(e._tw!==id) return;
      if(ultimo!==null && e.textContent!==ultimo) return; // otro render lo actualizó
      if(t0===null) t0=ts;
      var k=Math.min(1,(ts-t0)/ms);
      ultimo = k<1 ? pre+fmt.format(Math.round(desde+(hasta-desde)*easeOut(k))) : fin;
      e.textContent=ultimo;
      if(k<1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
  }
  // número animado al cambiar de valor (ej: "Podés gastar hoy" al anotar un gasto)
  function numVivo(e, valor){
    var prev=e._val;
    e._val=valor;
    if(prev!==undefined && prev!==valor) tweenNum(e, prev, valor, 650);
  }

  var SEL_NUMS = '.today .big, #kSaldo, #kHoy, .foco-saldo, .big-inline, .gb-v, .hist-v, .slider-val, '+
                 '.chart-svg text.t1, #todoSum, #ingTot, .obj-top .v b, .foco-v';
  var SEL_BARRAS = '.bar > div, .obj-bar > div, .gb-bar > div, .drow-progress > div, .bfill, .meter > div';

  function contarDesdeCero(scope){
    scope.querySelectorAll(SEL_NUMS).forEach(function(e){
      var m=e.textContent.match(/^(Gs\. |−|-)?([\d.]+)$/);
      if(m) tweenNum(e, 0, pn(m[2]), 950);
    });
  }
  function crecerBarras(scope){
    var lista=[];
    scope.querySelectorAll(SEL_BARRAS).forEach(function(e){
      var w=e.style.width; if(!w || w==='0%') return;
      e.style.transition='none'; e.style.width='0%'; lista.push([e,w]);
    });
    void scope.offsetWidth;
    setTimeout(function(){
      lista.forEach(function(x,i){
        x[0].style.transition=''; x[0].style.transitionDelay=Math.min(i*30,450)+'ms'; x[0].style.width=x[1];
        setTimeout(function(){ x[0].style.transitionDelay=''; }, 1500);
      });
    }, 30);
  }
  function dibujarTorta(scope){
    var segs=[].slice.call(scope.querySelectorAll('.chart-svg circle[stroke-dasharray]'));
    segs.forEach(function(c){
      var p=c.getAttribute('stroke-dasharray').split(' ').map(parseFloat);
      c.style.transition='none'; c.style.strokeDasharray='0 '+(p[0]+p[1]);
    });
    void scope.offsetWidth;
    setTimeout(function(){
      segs.forEach(function(c,i){
        c.style.transition='stroke-dasharray .9s cubic-bezier(.2,.8,.2,1) '+(i*0.08)+'s';
        c.style.strokeDasharray=c.getAttribute('stroke-dasharray');
        setTimeout(function(){ c.style.transition=''; }, 1100+i*80);
      });
    }, 30);
  }
  // al abrir una sección: entrada escalonada, números desde cero, barras y torta
  function entrarPanel(id){
    if(!MOV) return;
    var p=el('p-'+id); if(p===_noop) return;
    p.classList.remove('entra'); void p.offsetWidth; p.classList.add('entra');
    clearTimeout(p._tEntra); p._tEntra=setTimeout(function(){ p.classList.remove('entra'); }, 1000);
    contarDesdeCero(p);
    crecerBarras(p);
    dibujarTorta(p);
  }

  // ============ RENDER GLOBAL ============
  function sincronizarAporte(){
    // OBJETIVO DEL MES: cuánto pagar a la deuda más cara este ciclo (mínimo + extra).
    // Se calcula UNA sola vez al abrir el ciclo y queda CONGELADO en st.objetivoMes.
    // Así, cuando pagás y el saldo baja, el objetivo NO se recalcula: solo mostramos
    // cuánto falta de ese objetivo fijo. Sin esto, cada pago generaba un aporte nuevo.
    var ap = (st.todos||[]).filter(function(t){ return t.id==='t15'; })[0];
    if(!ap) return;

    // fijar el objetivo del ciclo si todavía no está fijado
    if(!st.objetivoMes || !st.objetivoMes.id){
      try{
        var sim=simular();
        var objId=sim.objetivoActual;
        if(objId){
          var plan=(sim.cal[0] && sim.cal[0].p[objId]) || 0;
          st.objetivoMes = { id:objId, monto:plan };
        }
      }catch(e){}
    }
    if(!st.objetivoMes || !st.objetivoMes.id) return;

    var objId=st.objetivoMes.id;
    ap.deuda=objId;
    ap.nm='Aporte extra a '+(nombreDeuda(objId).replace('Tarjeta ','').replace('Préstamo ',''));
    // si la fecha del aporte quedó vieja (mes anterior), moverla a este mes para que no diga 'vencido'
    var hoyISO=new Date().toISOString().slice(0,10);
    if(!ap.f || ap.f < hoyISO.slice(0,8)+'01'){
      var d2=new Date(); d2.setDate(28);
      ap.f = d2.toISOString().slice(0,10);
    }

    // lo ya pagado a esa deuda este ciclo
    var yaPag=(st.movs||[]).reduce(function(sum,m){ return sum + ((m.tipo==='deuda' && m.cat===objId)?m.monto:0); }, 0);

    if(ap.editado){ return; } // si lo editaste a mano, respetamos tu monto
    // el pendiente muestra lo que FALTA del objetivo del mes
    ap.monto = Math.max(0, st.objetivoMes.monto - yaPag);
    // si ya cubriste el objetivo, marcarlo hecho para que no moleste
    if(ap.monto<=0 && !ap.hecho){ ap.hecho=true; }
    if(ap.monto>0 && ap.hecho && yaPag < st.objetivoMes.monto){ /* sigue pendiente */ }
  }

  function renderPerfil(){
    el('warnPerfil').hidden = !PERFIL.demo;
    el('saldoCuenta').textContent = 'lo que tenés en '+(PERFIL.cuenta||'tu cuenta');
    el('puenteMontoTxt').textContent = PERFIL.puenteMonto ? gs(PERFIL.puenteMonto) : 'un monto fijo';
  }

  function renderAll(){
    aplicarPerfil();
    renderPerfil();
    poblarCatPendiente();
    sincronizarAporte();
    renderChips();
    syncDesc();
    renderTodos();
    renderExtras();
    var res=renderCats();
    renderTorta(res.g);
    renderBarras();
    renderObjetivos();
    renderAhorro();
    renderMovs();
    var pd=renderHoy(res);
    renderAdvice(res,pd);
    renderPresu();
    renderDeudas();
    renderEditorDeudas();
    renderHist();

    var sobra = ingreso() - cuotasFijas() - st.aporte - totalMetas();
    var k=el('kSobra');
    k.textContent=(sobra<0?'−':'')+gs(Math.abs(sobra));
    k.className='v '+(sobra<0?'bad':'ok');

    el('saldo').value=fmt.format(st.saldo);
    el('cobro').value=st.cobro;
  }

  // ============ ACCIONES ============
  function anotar(){
    var v=pn(el('amt').value); if(v<=0){ el('amt').focus(); return; }
    var det=el('desc').value.trim();
    if(st.sel==='otros' && !det){ el('desc').focus(); setStatus('Poné en qué fue.'); return; }
    var d=new Date(), f=d.getDate()+'/'+(d.getMonth()+1);
    st.movs.push({cat:st.sel, monto:v, f:f, d:det});
    st.saldo=Math.max(0,st.saldo-v);
    el('amt').value=''; el('desc').value='';
    renderAll(); guardar();
  }

  var KEY='plan-financiero:v1';
  function setStatus(t){
    var b=el('toast');
    b.textContent=t; b.hidden=!t;
    if(t){ clearTimeout(setStatus._t); setStatus._t=setTimeout(function(){ b.hidden=true; },3000); }
  }
  async function guardar(){
    var txt=JSON.stringify(st);
    if(txt===undefined || txt==='undefined' || !txt){ return; } // nunca guardar basura
    try{
      if(window.storage){ var r=await window.storage.set(KEY, txt, false); if(r){ el('warnSave').hidden=true; return; } }
    }catch(e){}
    // GitHub Pages / navegador normal: localStorage
    try{
      localStorage.setItem(KEY, txt);
      el('warnSave').hidden=true;
    }catch(e){
      el('warnSave').hidden=false;
    }
    syncMarcarCambio();
  }
  async function cargar(){
    var raw=null;
    try{ if(window.storage){ var r=await window.storage.get(KEY,false); if(r&&r.value) raw=r.value; } }catch(e){}
    if(!raw){ try{ raw=localStorage.getItem(KEY); }catch(e){} }
    if(raw==='undefined' || raw==='null' || raw==='') raw=null;
    if(raw){
      try{
        {
          var d=JSON.parse(raw);
          // completar claves faltantes con la base, para que un guardado viejo no rompa nada
          Object.keys(BASE).forEach(function(k){
            if(d[k]===undefined || d[k]===null) d[k]=clon(BASE[k]);
          });
          if(typeof d.deudas!=='object') d.deudas=clon(BASE.deudas);
          if(!Array.isArray(d.grupos)||!d.grupos.length) d.grupos=clon(BASE.grupos);
          if(!Array.isArray(d.todos)) d.todos=clon(BASE.todos);
          // limpiar el campo 'real' viejo de las categorías (dato de julio que confundía las barras)
          (d.grupos||[]).forEach(function(g){
          if(!g.t) g.t=g.nm||'Grupo';
          (g.items||[]).forEach(function(i){ delete i.real; });
        });
          // reubicar movimientos mal puestos en 'otros' cuyo texto coincide con una categoría real
          //  (ej: gasto de Tenis anotado como 'otros' con detalle 'Tenis')
          var mapaNom = {};
          (d.grupos||[]).forEach(function(g){ (g.items||[]).forEach(function(i){
            if(i.nm) mapaNom[i.nm.toLowerCase()] = i.id;
            if(i.corto) mapaNom[i.corto.toLowerCase()] = i.id;
          }); });
          (d.movs||[]).forEach(function(m){
            if((m.cat==='otros' || !m.cat) && m.d){
              var clave = m.d.toLowerCase().trim();
              // coincidencia exacta o si el detalle empieza con el nombre de la categoría
              for(var nom in mapaNom){
                if(nom && nom!=='otros' && (clave===nom || clave.indexOf(nom)===0)){
                  m.cat = mapaNom[nom]; break;
                }
              }
            }
          });
          // reparar la CATEGORÍA de pendientes de gasto que la perdieron (estados viejos)
          var CATFIX = {t8:'gym', t9:'tenis', t12:'mascota'};
          d.todos.forEach(function(t){
            if(CATFIX[t.id] && !t.cat) t.cat = CATFIX[t.id];
          });
          // corregir movimientos viejos que quedaron con cat 'otros' pero son de un pendiente con cat propia
          (d.movs||[]).forEach(function(m){
            if(m.src && CATFIX[m.src] && m.cat!==CATFIX[m.src]){ m.cat = CATFIX[m.src]; }
          });
          // REPARAR inconsistencias pendiente<->movimiento de estados viejos:
          // si un pendiente está tildado pero no tiene su movimiento, crearlo;
          // si está destildado pero quedó un movimiento suyo, quitarlo.
          d.movs = d.movs || [];
          d.todos.forEach(function(t){
            if(t.monto>0){
              var tieneMovSuyo = d.movs.some(function(m){ return m.src===t.id; });
              if(t.hecho && !tieneMovSuyo){
                // tildado sin movimiento -> crear el movimiento que falta
                if(t.deuda){
                  d.movs.push({cat:t.deuda, tipo:'deuda', monto:t.monto, f:t.f||'', src:t.id, d:t.nm});
                } else {
                  d.movs.push({cat:(t.cat||'otros'), monto:t.monto, f:t.f||'', src:t.id, d:t.nm});
                }
              } else if(!t.hecho && tieneMovSuyo){
                // destildado con movimiento colgado -> limpiarlo
                d.movs = d.movs.filter(function(m){ return m.src!==t.id; });
              }
            }
          });
          // insertar el pendiente del aporte extra si un guardado viejo no lo tiene
          if(!d.todos.some(function(t){ return t.id==='t15'; })){
            var base15=BASE.todos.filter(function(t){return t.id==='t15';})[0];
            if(base15) d.todos.push(clon(base15));
          }
          if(!Array.isArray(d.movs))  d.movs=[];
          if(!Array.isArray(d.extras)) d.extras=[];
          if(!Array.isArray(d.ahorros))  d.ahorros=clon(BASE.ahorros);
          if(!d.aporte || d.aporte<=0) d.aporte=BASE.aporte;
          if(typeof d.ciclo!=='object'||!d.ciclo) d.ciclo=clon(BASE.ciclo);
          if(typeof d.ing!=='object') d.ing=clon(BASE.ing);
          if(!Array.isArray(d.hist)) d.hist=[];
          d = sanearDatos(d);
          st=d;
        }
      }catch(e){ /* guardado ilegible: seguimos con la base */ }
    }
    st.cobro=st.cobro||defaultCobro();
    renderAll();
  }

  // ============ SINCRONIZACIÓN ENTRE DISPOSITIVOS ============
  // Los datos se cifran en este dispositivo (AES-GCM) con una clave que sale de tu frase.
  // El servidor solo guarda texto cifrado bajo un id que también sale de la frase:
  // sin la frase, nadie (ni el servidor) puede leer tus números.
  var SYNC_URL = 'https://my-money-sync.vercel.app/api/sync';
  var SYNC_KEY = 'mm-sync:v1';      // {id, k, etag, pend, ult, remotoAt, remotoDev}
  var SYNC_DESCARTE = 'mm-sync:descartado';
  var sync = null, syncClave = null, syncEstado = 'off', syncConflicto = null, syncAplicando = false, syncTimer = null, syncEnCurso = false;

  var b64 = function(buf){ var s='', b=new Uint8Array(buf); for(var i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); };
  var deB64 = function(t){ var s=atob(t), b=new Uint8Array(s.length); for(var i=0;i<s.length;i++) b[i]=s.charCodeAt(i); return b; };
  var hex = function(b){ return Array.prototype.map.call(b, function(x){ return ('0'+x.toString(16)).slice(-2); }).join(''); };
  function nombreDispositivo(){ return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Teléfono' : 'Compu'; }
  // la frase se normaliza: sin espacios ni guiones y en minúsculas, así "ABCD-efgh" = "abcd efgh"
  function normalizarFrase(f){ return String(f||'').normalize('NFKC').toLowerCase().replace(/[\s\-_.]+/g,''); }
  function generarFrase(){
    var abc='abcdefghjkmnpqrstuvwxyz23456789', r=new Uint8Array(20), out=[];
    crypto.getRandomValues(r);
    for(var i=0;i<20;i++){ out.push(abc[r[i]%abc.length]); if(i%4===3 && i<19) out.push('-'); }
    return out.join('');
  }
  async function derivar(frase){
    var base=await crypto.subtle.importKey('raw', new TextEncoder().encode(frase), 'PBKDF2', false, ['deriveBits']);
    var bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:new TextEncoder().encode('my-money:sync:v1'), iterations:600000}, base, 512));
    return { k: b64(bits.slice(0,32)), id: hex(bits.slice(32)) };
  }
  async function claveAes(){
    if(!syncClave) syncClave = await crypto.subtle.importKey('raw', deB64(sync.k), 'AES-GCM', false, ['encrypt','decrypt']);
    return syncClave;
  }
  async function cifrar(obj){
    var iv=crypto.getRandomValues(new Uint8Array(12));
    var ct=await crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, await claveAes(), new TextEncoder().encode(JSON.stringify(obj)));
    return {v:1, iv:b64(iv), ct:b64(ct), at:Date.now(), dev:nombreDispositivo()};
  }
  async function descifrar(p){
    var pt=await crypto.subtle.decrypt({name:'AES-GCM', iv:deB64(p.iv)}, await claveAes(), deB64(p.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function guardarMeta(){ try{ if(sync) localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); else localStorage.removeItem(SYNC_KEY); }catch(e){} }
  function cargarMeta(){ try{ var m=JSON.parse(localStorage.getItem(SYNC_KEY)||'null'); if(m && m.id && m.k) sync=m; }catch(e){} }
  function tieneDatosPropios(){ return (st.movs||[]).length>0 || (PERFIL && !PERFIL.demo && DEUDAS_META.length>0); }

  function ponerEstado(e){ syncEstado=e; renderSync(); }

  // lo llama guardar(): marca que hay cambios y programa la subida
  function syncMarcarCambio(){
    if(!sync || syncAplicando) return;
    sync.pend=true; guardarMeta();
    clearTimeout(syncTimer); syncTimer=setTimeout(subir, 2500);
    if(syncEstado!=='conflicto') ponerEstado('pendiente');
  }

  async function subir(forzarEtag){
    if(!sync || syncEnCurso) return;
    if(syncConflicto && forzarEtag===undefined) return; // esperar a que elijas
    if(!navigator.onLine){ ponerEstado('offline'); return; }
    syncEnCurso=true; ponerEstado('subiendo');
    try{
      var etag = forzarEtag!==undefined ? forzarEtag : sync.etag;
      var h={'Content-Type':'application/json'}; if(etag) h['If-Match']=etag;
      var cuerpo=JSON.stringify(await cifrar(st));
      // keepalive deja terminar la subida aunque cierres la app, pero solo acepta cuerpos chicos
      var r=await fetch(SYNC_URL+'?id='+sync.id, {method:'PUT', headers:h, body:cuerpo, keepalive:cuerpo.length<60000});
      if(r.status===412){ syncEnCurso=false; await bajar(true); return; }
      if(!r.ok) throw new Error('HTTP '+r.status);
      sync.etag=r.headers.get('ETag'); sync.pend=false; sync.ult=Date.now(); sync.remotoDev=nombreDispositivo(); sync.remotoAt=sync.ult;
      guardarMeta(); syncConflicto=null; ponerEstado('ok');
    }catch(e){ ponerEstado(navigator.onLine?'error':'offline'); }
    syncEnCurso=false;
  }

  // trae lo último de la nube. Si acá también hay cambios sin subir, te pregunta.
  async function bajar(trasRechazo){
    if(!sync || syncEnCurso) return;
    if(!navigator.onLine){ ponerEstado('offline'); return; }
    syncEnCurso=true; if(syncEstado!=='conflicto') ponerEstado('bajando');
    try{
      var h={}; if(sync.etag && !trasRechazo) h['If-None-Match']=sync.etag;
      var r=await fetch(SYNC_URL+'?id='+sync.id, {headers:h, cache:'no-store'});
      syncEnCurso=false;
      if(r.status===304){ sync.ult=Date.now(); guardarMeta(); if(sync.pend) subir(); else ponerEstado('ok'); return; }
      if(r.status===404){ sync.etag=null; guardarMeta(); subir(); return; } // nube vacía: subir lo de acá
      if(!r.ok) throw new Error('HTTP '+r.status);
      var etag=r.headers.get('ETag'), p=await r.json(), remoto=await descifrar(p);
      if(sync.pend || trasRechazo){
        syncConflicto={estado:remoto, etag:etag, at:p.at, dev:p.dev};
        ponerEstado('conflicto');
        return;
      }
      aplicarRemoto(remoto, etag, p);
    }catch(e){ syncEnCurso=false; ponerEstado(navigator.onLine?'error':'offline'); }
  }

  function aplicarRemoto(remoto, etag, p){
    syncAplicando=true;
    try{
      st = normalizarEstado(remoto);
      sync.etag=etag; sync.pend=false; sync.ult=Date.now();
      if(p){ sync.remotoAt=p.at; sync.remotoDev=p.dev; }
      guardarMeta(); renderAll(); guardar();
    } finally { syncAplicando=false; }
    syncConflicto=null; ponerEstado('ok');
  }

  function guardarDescartado(estado){ try{ localStorage.setItem(SYNC_DESCARTE, JSON.stringify({at:Date.now(), estado:estado})); }catch(e){} }

  async function conectar(frase){
    var f=normalizarFrase(frase);
    if(f.length<12){ ponerAviso('La frase tiene que tener al menos 12 letras o números. Usá «Generar una frase segura» si querés.'); return; }
    if(!window.crypto || !crypto.subtle){ ponerAviso('Este navegador no permite cifrar datos. Abrí la app desde la dirección https.'); return; }
    ponerAviso(''); ponerEstado('conectando');
    try{
      var d=await derivar(f);
      sync={id:d.id, k:d.k, etag:null, pend:false, ult:null, remotoAt:null, remotoDev:null}; syncClave=null;
      var r=await fetch(SYNC_URL+'?id='+sync.id, {cache:'no-store'});
      if(r.status===404){ guardarMeta(); await subir(); setStatus('Listo: este dispositivo subió tus datos a la nube.'); return; }
      if(!r.ok) throw new Error('HTTP '+r.status);
      var etag=r.headers.get('ETag'), p=await r.json(), remoto=await descifrar(p);
      guardarMeta();
      if(tieneDatosPropios()){
        // los dos lados tienen datos: elegís vos
        syncConflicto={estado:remoto, etag:etag, at:p.at, dev:p.dev, inicial:true};
        ponerEstado('conflicto');
      } else {
        aplicarRemoto(remoto, etag, p);
        setStatus('Listo: se cargaron tus datos de la nube.');
      }
    }catch(e){
      sync=null; syncClave=null; guardarMeta();
      ponerAviso('No se pudo conectar. Revisá la conexión a internet e intentá de nuevo.');
      ponerEstado('off');
    }
  }
  function desconectar(){
    clearTimeout(syncTimer); sync=null; syncClave=null; syncConflicto=null; guardarMeta(); ponerEstado('off');
    setStatus('Este dispositivo dejó de sincronizar. Tus datos siguen acá.');
  }
  function elegirLocal(){
    if(!syncConflicto) return;
    guardarDescartado(syncConflicto.estado);
    var etag=syncConflicto.etag; syncConflicto=null;
    subir(etag);
  }
  function elegirNube(){
    if(!syncConflicto) return;
    guardarDescartado(st);
    var c=syncConflicto; aplicarRemoto(c.estado, c.etag, {at:c.at, dev:c.dev});
    setStatus('Listo: ahora tenés los datos de la nube.');
  }

  function haceCuanto(t){
    if(!t) return 'nunca';
    var s=Math.round((Date.now()-t)/1000);
    if(s<60) return 'recién'; if(s<3600) return 'hace '+Math.round(s/60)+' min';
    if(s<86400) return 'hace '+Math.round(s/3600)+' h';
    return new Date(t).toLocaleDateString('es-PY',{day:'numeric', month:'short'});
  }
  function ponerAviso(t){ var a=el('syncMsg'); a.textContent=t; a.hidden=!t; }

  var SYNC_TXT = {
    off:['','Sin sincronizar'], conectando:['run','Conectando…'], subiendo:['run','Sincronizando…'], bajando:['run','Sincronizando…'],
    pendiente:['run','Cambios por subir'], ok:['ok','Sincronizado'], offline:['off','Sin conexión · se sube al volver'],
    error:['bad','No se pudo sincronizar'], conflicto:['bad','Elegí qué datos conservar']
  };
  function renderSync(){
    var activo=!!sync, t=SYNC_TXT[syncEstado]||SYNC_TXT.off;
    el('syncOff').hidden=activo;
    el('syncOn').hidden=!activo;
    var chip=el('syncChip');
    chip.hidden=!activo; chip.className='sync-chip '+t[0]; chip.querySelector('span').textContent=t[1];
    if(!activo) return;
    el('syncEstado').className='sync-estado '+t[0];
    el('syncEstado').textContent=t[1];
    el('syncDetalle').textContent = 'Última sincronización: '+haceCuanto(sync.ult)+
      (sync.remotoDev ? ' · último cambio desde '+sync.remotoDev+' '+haceCuanto(sync.remotoAt) : '');
    var c=el('syncConflicto');
    c.hidden=!syncConflicto;
    if(syncConflicto){
      el('syncConfTxt').textContent = syncConflicto.inicial
        ? 'En la nube ya hay datos (último cambio desde '+(syncConflicto.dev||'otro dispositivo')+', '+haceCuanto(syncConflicto.at)+') y este dispositivo también tiene los suyos. ¿Con cuáles te quedás?'
        : 'Cambiaste cosas acá y también en '+(syncConflicto.dev||'otro dispositivo')+' ('+haceCuanto(syncConflicto.at)+'). ¿Con cuáles te quedás?';
    }
    var hayDescarte=false; try{ hayDescarte=!!localStorage.getItem(SYNC_DESCARTE); }catch(e){}
    el('syncDescarte').hidden=!hayDescarte;
  }
  function descargarDescartado(){
    try{
      var d=JSON.parse(localStorage.getItem(SYNC_DESCARTE));
      var a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([JSON.stringify(d.estado,null,2)],{type:'application/json'}));
      a.download='my-money-version-descartada-'+new Date(d.at).toISOString().slice(0,10)+'.json';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },0);
    }catch(e){ setStatus('No hay una versión descartada para descargar.'); }
  }

  el('syncGen').addEventListener('click', function(){ el('syncFrase').value=generarFrase(); el('syncFrase').select(); ponerAviso('Anotá esta frase en un lugar seguro: la vas a necesitar en tu otro dispositivo.'); });
  el('syncCon').addEventListener('click', function(){ conectar(el('syncFrase').value); });
  el('syncFrase').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); conectar(el('syncFrase').value); } });
  el('syncAhora').addEventListener('click', function(){ if(sync && sync.pend) subir(); else bajar(); });
  el('syncDes').addEventListener('click', function(){
    var b=el('syncDes');
    if(!b.dataset.ok){ b.dataset.ok='1'; b.textContent='¿Seguro? Tocá de nuevo'; return; }
    delete b.dataset.ok; b.textContent='Desconectar este dispositivo'; desconectar();
  });
  el('syncUsarLocal').addEventListener('click', elegirLocal);
  el('syncUsarNube').addEventListener('click', elegirNube);
  el('syncDescarte').addEventListener('click', descargarDescartado);
  el('syncChip').addEventListener('click', function(){ document.querySelector('.tab[data-p=hoy]').click(); setTimeout(function(){ el('syncCard').scrollIntoView({behavior:'smooth', block:'center'}); }, 60); });

  // cuándo sincronizar: al abrir, al volver a la app, al recuperar la conexión y antes de salir
  document.addEventListener('visibilitychange', function(){
    if(!sync) return;
    if(document.visibilityState==='visible') bajar();
    else if(sync.pend){ clearTimeout(syncTimer); subir(); }
  });
  window.addEventListener('online', function(){ if(sync){ if(sync.pend) subir(); else bajar(); } });
  window.addEventListener('offline', function(){ if(sync) ponerEstado('offline'); });
  setInterval(function(){ if(sync && !document.hidden) renderSync(); }, 30000); // refrescar el "hace X min"

  function iniciarSync(){
    cargarMeta();
    if(sync){ ponerEstado(sync.pend?'pendiente':'ok'); bajar(); }
    else renderSync();
  }

  // ============ INIT ============
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('.tab').forEach(function(x){ x.setAttribute('aria-selected', x===t?'true':'false'); });
      ['hoy','presu','ahorro','deudas','hist'].forEach(function(p){ el('p-'+p).hidden = (p!==t.dataset.p); });
      window.scrollTo({top:0, behavior:'instant'});
      entrarPanel(t.dataset.p);
    });
  });

  el('addBtn').addEventListener('click', anotar);
  el('amt').addEventListener('keydown', function(e){ if(e.key==='Enter'){e.preventDefault();anotar();} });
  el('desc').addEventListener('keydown', function(e){ if(e.key==='Enter'){e.preventDefault();anotar();} });

  el('saldo').addEventListener('change', function(){ st.saldo=pn(el('saldo').value); renderAll(); guardar(); });

  function poblarCatPendiente(){
    var sel=el('tCat'); if(!sel) return;
    // se rearma solo si cambiaron las categorías o el perfil (ej: al cargar el perfil privado)
    var clave=JSON.stringify(todosItems().map(function(c){return c.id+(c.corto||c.nm);}))+DEUDAS_META.map(function(m){return m.corto;}).join();
    if(sel.options.length && poblarCatPendiente._k===clave) return;
    poblarCatPendiente._k=clave;
    var previo=sel.value;
    var html='<option value="">Sin categoría</option>';
    html+='<optgroup label="Gasto">';
    todosItems().forEach(function(c){ html+='<option value="cat:'+c.id+'">'+(c.corto||c.nm)+'</option>'; });
    html+='</optgroup><optgroup label="Deuda">';
    DEUDAS_META.forEach(function(m){ html+='<option value="deuda:'+m.id+'">'+m.corto+'</option>'; });
    html+='</optgroup>';
    sel.innerHTML=html;
    sel.value=previo;
  }
  function addTodo(){
    var n=el('tNm').value.trim(); if(!n){ el('tNm').focus(); return; }
    var nuevo={
      id:'t'+Date.now(), nm:n, monto:pn(el('tAmt').value),
      f: el('tFec').value || new Date().toISOString().slice(0,10),
      hecho:false, rec:false, nota:''
    };
    // asignar categoría o deuda según lo elegido
    var elegido=el('tCat').value;
    if(elegido.indexOf('cat:')===0) nuevo.cat=elegido.slice(4);
    else if(elegido.indexOf('deuda:')===0) nuevo.deuda=elegido.slice(6);
    st.todos.push(nuevo);
    el('tNm').value=''; el('tAmt').value=''; el('tFec').value=''; el('tCat').value='';
    renderAll(); guardar();
  }
  el('tAdd').addEventListener('click', addTodo);
  ['tNm','tAmt'].forEach(function(k){
    el(k).addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addTodo(); } });
  });
  el('cobro').addEventListener('change', function(){ st.cobro=el('cobro').value; renderAll(); guardar(); });

  ['usd','tc','fee','retiros','extra'].forEach(function(k){
    el(k).addEventListener('change', function(){ st.ing[k]=pn(el(k).value); renderAll(); guardar(); });
  });

  el('aporte').addEventListener('input', function(){
    st.aporte=+el('aporte').value; el('aporteVal').textContent='Gs. '+gs(st.aporte);
    renderAll();
  });
  el('aporte').addEventListener('change', guardar);
  el('puenteChk').addEventListener('change', function(){ st.puente=el('puenteChk').checked; renderAll(); guardar(); });


  function sumaMeses(iso, n){
    var d=new Date(iso+'T00:00:00'); d.setMonth(d.getMonth()+n); return d.toISOString().slice(0,10);
  }
  function sumaDias(iso, n){
    var d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10);
  }
  function esPrimeroDelMes(f){
    var c=st.ciclo||{inicio:f,cobros:[]};
    // si el ciclo arrancó hace 20 días o más, este cobro abre mes nuevo
    return Math.round((new Date(f+'T00:00:00') - new Date(c.inicio+'T00:00:00'))/86400000) >= 20;
  }
  function archivarMes(){
    // foto de cómo cerró el mes que termina
    st.hist = st.hist || [];
    var gastos = (st.movs||[]).filter(esGasto).reduce(function(a,v){return a+v.monto;},0);
    var pagosDeuda = (st.movs||[]).filter(function(v){return v.tipo==='deuda';}).reduce(function(a,v){return a+v.monto;},0);
    var ahorro = (st.movs||[]).filter(function(v){return v.tipo==='ahorro';}).reduce(function(a,v){return a+v.monto;},0);
    var deudaTot = deudaTotal();
    // deuda al INICIO del mes = deuda al cerrar del mes anterior (último registro del historial)
    var deudaInicial = (st.hist && st.hist.length) ? (st.hist[0].deudaTotal||null) : null;
    var hoy=new Date();
    // el mes que se archiva es el del INICIO del ciclo que termina (no el de hoy).
    // Ej: cerrás a principios de septiembre un ciclo que arrancó el 2 de agosto -> etiqueta 'agosto'.
    var mesCiclo;
    if(st.ciclo && st.ciclo.inicio){
      mesCiclo = new Date(st.ciclo.inicio+'T00:00:00');
    } else {
      // sin ciclo: asumir el mes anterior al actual
      mesCiclo = new Date(); mesCiclo.setMonth(mesCiclo.getMonth()-1);
    }
    st.hist.unshift({
      cerrado: hoy.toISOString().slice(0,10),
      etiqueta: LARGO[mesCiclo.getMonth()]+' '+mesCiclo.getFullYear(),
      ingreso: ingreso(),
      presupuestado: totalMetas(),
      gastos:gastos, pagosDeuda:pagosDeuda, ahorro:ahorro,
      saldoFinal:st.saldo, deudaInicial:deudaInicial, deudaTotal:deudaTot,
      movimientos:(st.movs||[]).length
    });
    if(st.hist.length>60) st.hist=st.hist.slice(0,60);
  }

  function cerrarCiclo(f){
    archivarMes();
    (st.todos||[]).forEach(function(t){ if(t.id==='t15'){ t.editado=false; t.hecho=false; } });
    st.objetivoMes=null;
    st.movs=[];
    var nuevos=[];
    (st.todos||[]).forEach(function(t){
      if(!t.rec){
        // tarea suelta: se va si ya la hiciste, sigue pendiente si no
        if(!t.hecho) nuevos.push(t);
        return;
      }
      if(t.hecho){
        // pago fijo cumplido: vuelve a quedar pendiente el mes que viene
        t.hecho=false; t.f=sumaMeses(t.f,1); t.nota=(t.nota||'').replace(/\s*Quedó impago del ciclo anterior\.?/,''); nuevos.push(t);
      } else {
        // pago fijo NO tildado al cerrar: sigue pendiente CON SU FECHA ACTUAL.
        // No le sumamos un mes: si vence ahora (ej: cuota que cae el 2), tiene que
        // seguir apareciendo como 'vence ahora', no corrido al mes siguiente.
        // (Tu flujo es cobrar y después pagar: al cobrar, estos pagos recién vencen.)
        t.hecho=false; nuevos.push(t);
      }
    });
    st.todos=nuevos;
    st.ciclo={inicio:f, cobros:[f]};
  }
  function registrarCobro(){
    var monto=pn(el('cMonto').value);
    var f=el('cFecha').value || new Date().toISOString().slice(0,10);
    if(monto<=0){ el('cMonto').focus(); return; }
    var cierra=el('cPrimero').checked;

    st.saldo+=monto;
    if(cierra){ cerrarCiclo(f); st.cobro=sumaDias(f,14); }
    else {
      st.ciclo=st.ciclo||{inicio:f,cobros:[]};
      st.ciclo.cobros.push(f);
      st.cobro=sumaMeses(st.ciclo.inicio,1);
    }
    el('cobreForm').hidden=true;
    renderAll(); guardar();
    setStatus(cierra?'Cobro registrado. Ciclo nuevo abierto.':'Cobro registrado. Sigue el mismo ciclo.');
  }

  el('cobreBtn').addEventListener('click', function(){
    var f=new Date().toISOString().slice(0,10);
    el('cFecha').value=f;
    if(!pn(el('cMonto').value) && PERFIL.cobroMonto) el('cMonto').value=fmt.format(PERFIL.cobroMonto);
    var pri=esPrimeroDelMes(f);
    el('cPrimero').checked=pri;
    el('cPrimeroTxt').textContent = pri
      ? 'Es el primer cobro del mes — cierra el ciclo y arranca el presupuesto nuevo'
      : 'Es el primer cobro del mes (destildado: solo repone el saldo, sigue el ciclo actual)';
    el('cobreForm').hidden=!el('cobreForm').hidden;
  });
  el('cCancel').addEventListener('click', function(){ el('cobreForm').hidden=true; });
  el('cOk').addEventListener('click', registrarCobro);

  function exportar(){
    try{
      var blob=new Blob([JSON.stringify(st,null,2)],{type:'application/json'});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='plan-financiero-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },0);
      setStatus('Respaldo descargado.');
    }catch(e){ setStatus('No se pudo descargar.'); }
  }
  // completa y repara un estado completo (respaldo restaurado o datos que llegan de la nube)
  function normalizarEstado(d){
    // respaldos viejos no traen perfil: conservar el que ya está cargado
    if(!d.perfil && st.perfil) d.perfil=clon(st.perfil);
    Object.keys(BASE).forEach(function(k){ if(d[k]===undefined||d[k]===null) d[k]=clon(BASE[k]); });
    // reparar sub-objetos incompletos (respaldos viejos incompletos)
    if(typeof d.deudas!=='object'||!d.deudas) d.deudas=clon(BASE.deudas);
    Object.keys(BASE.deudas).forEach(function(k){ if(d.deudas[k]===undefined||d.deudas[k]===null) d.deudas[k]=BASE.deudas[k]; });
    if(!d.aporte || d.aporte<=0) d.aporte=BASE.aporte;
    if(typeof d.ing!=='object'||!d.ing) d.ing=clon(BASE.ing);
    if(!Array.isArray(d.grupos)||!d.grupos.length) d.grupos=clon(BASE.grupos);
    if(!Array.isArray(d.ahorros)) d.ahorros=clon(BASE.ahorros);
    if(!Array.isArray(d.todos)) d.todos=clon(BASE.todos);
    if(!d.todos.some(function(t){ return t.id==='t15'; })){
      var b15=BASE.todos.filter(function(t){return t.id==='t15';})[0];
      if(b15) d.todos.push(clon(b15));
    }
    if(!Array.isArray(d.movs)) d.movs=[];
    if(!Array.isArray(d.extras)) d.extras=[];
    if(!Array.isArray(d.hist)) d.hist=[];
    // limpiar el campo 'real' viejo de las categorías
    (d.grupos||[]).forEach(function(g){ if(!g.t) g.t=g.nm||'Grupo'; (g.items||[]).forEach(function(i){ delete i.real; }); });
    // saneamiento completo: categorías, reubicación y deduplicación
    d = sanearDatos(d);
    return d;
  }

  function importar(file){
    var r=new FileReader();
    r.onload=function(){
      try{
        var d=JSON.parse(r.result);
        // archivo de perfil privado: solo reemplaza el perfil, no toca tus movimientos
        if(d && d.perfil && !d.movs && !d.grupos){
          if(!Array.isArray(d.perfil.deudas)) throw new Error('perfil inválido');
          d.perfil.demo=false;
          st.perfil=d.perfil; renderAll(); guardar();
          setStatus('Perfil cargado.');
          return;
        }
        d = normalizarEstado(d);
        st=d; renderAll(); guardar();
        setStatus('Respaldo restaurado y ordenado.');
      }catch(e){ setStatus('El archivo no se pudo leer.'); }
    };
    r.readAsText(file);
  }
  el('expBtn').addEventListener('click', exportar);
  el('impBtn').addEventListener('click', function(){ el('impFile').click(); });
  el('perfilBtn').addEventListener('click', function(){ el('impFile').click(); });
  el('impFile').addEventListener('change', function(e){
    if(e.target.files && e.target.files[0]) importar(e.target.files[0]);
    e.target.value='';
  });

  function addAhorro(){
    var n=el('aNm').value.trim(); if(!n){ el('aNm').focus(); return; }
    var d=new Date(); d.setFullYear(d.getFullYear()+1);
    st.ahorros=st.ahorros||[];
    st.ahorros.push({id:'a'+Date.now(), nm:n, obj:pn(el('aObj').value), guardado:0, aporte:0,
                     fecha:d.toISOString().slice(0,10), nota:''});
    el('aNm').value=''; el('aObj').value='';
    renderAll(); guardar();
  }
  el('aAdd').addEventListener('click', addAhorro);
  el('dAdd').addEventListener('click', addDeuda);
  el('dNm').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addDeuda(); } });
  ['aNm','aObj'].forEach(function(k){
    el(k).addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addAhorro(); } });
  });

  function addExtra(){
    var n=el('eNm').value.trim(); if(!n){ el('eNm').focus(); return; }
    var monto=pn(el('eAmt').value);
    st.extras=st.extras||[];
    st.extras.push({id:'e'+Date.now(), nm:n, monto:monto});
    st.saldo+=monto; // el ingreso entra a tu cuenta
    el('eNm').value=''; el('eAmt').value='';
    renderAll(); guardar();
    setStatus('Ingreso extra sumado.');
  }
  el('eAdd').addEventListener('click', addExtra);
  ['eNm','eAmt'].forEach(function(k){
    el(k).addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addExtra(); } });
  });

  el('nuevoMes').addEventListener('click', function(){
    cerrarCiclo(new Date().toISOString().slice(0,10));
    renderAll(); guardar();
    setStatus('Ciclo cerrado a mano. Los pagos fijos vuelven a estar pendientes.');
  });
  el('cerrarMesBtn').addEventListener('click', function(){
    cerrarCiclo(new Date().toISOString().slice(0,10));
    renderAll(); guardar();
    setStatus('Mes cerrado y guardado en el historial.');
  });
  el('saveBtn').addEventListener('click', function(){ guardar(); setStatus('Guardado.'); });
  el('resetBtn').addEventListener('click', function(){
    var perfil=st.perfil;
    st=clon(BASE); st.perfil=perfil; st.cobro=defaultCobro(); renderAll(); guardar();
    setStatus('Volviste al original.');
  });

  st.cobro=defaultCobro();
  renderAll();
  cargar().then(function(){
    var activa=document.querySelector('.tab[aria-selected="true"]');
    entrarPanel(activa ? activa.dataset.p : 'hoy');
    contarDesdeCero(el('kSaldo').parentNode.parentNode);
    iniciarSync();
  });

  // ---- PWA: service worker para que abra sin conexión (sw.js) ----
  if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='127.0.0.1' || location.hostname==='localhost')){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  }
})();
