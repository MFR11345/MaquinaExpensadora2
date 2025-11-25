// script.js - Reescritura completa manteniendo todas las funcionalidades originales
// + machine.init, carga desde stockmachine (vía proxy.php para evitar CORS), corrección de URLs,
// + control de stock por máquina, decremento al confirmar pago, modales, popup, etc.

document.addEventListener("DOMContentLoaded", () => {

  // ---------- Estado principal ----------
  let carrito = []; // items: { id, nombre, precio, imagen, cantidad, productoCompleto }
  let total = 0;
  let productosAPI = [];    // lista de productos que se muestran (provenientes de stockmachine)
  let categoriasAPI = [];   // categorías derivadas del stock (name + image)
  let categoriaActiva = "todos";
  let mapaCategoriasId = {}; // si hay ids, no siempre existen en stockmachine
  let stockByProduct = {}; // cache productId -> stock
  let MACHINE_ID = null;

  // ---------- Config / rutas ----------
  const API_PROXY = "api.php?endpoint="; // tu proxy para la API general (usa si lo necesitas)
  const PROXY_PHP = "proxy.php?url=";    // proxy para imágenes / recursos (MISMO ORIGEN, evita CORS)
  const STOCK_API_BASE = "https://valentin.jbcomputers.com.gt/machine/monkeychef/api/v1/stockmachine";

  // ---------- Elementos UI ----------
  const txtContador = document.getElementById("contadorCarrito");
  const txtTotal = document.getElementById("totalCarrito");
  const popup = document.getElementById("popupAgregado");

  const modalDetalle = document.getElementById("modalDetalleProducto");
  const modalCarrito = document.getElementById("modalCarrito");
  const modalPago = document.getElementById("modalPago");
  const modalCarritoVacio = document.getElementById("modalCarritoVacio");

  const listaCarrito = document.getElementById("listaCarrito");
  const listaPago = document.getElementById("listaPago");

  const totalCarritoModal = document.getElementById("totalCarritoModal");
  const totalPago = document.getElementById("totalPago");

  const btnCerrarModal = document.getElementById("cerrarModal");
  const btnAgregarModal = document.getElementById("agregarDesdeModal");
  const btnCarrito = document.querySelector(".btn-productos");
  const btnCerrarCarrito = document.getElementById("cerrarCarrito");
  const btnPagar = document.getElementById("btnPagar");
  const btnCerrarPago = document.getElementById("cerrarPago");
  const btnCerrarModalCarritoVacio = document.getElementById("cerrarModalCarritoVacio");

  // ---------- Utilidades UI ----------
  function showErrorBanner(message) {
    let banner = document.getElementById('errorBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'errorBanner';
      banner.style.position = 'fixed';
      banner.style.top = '10px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.zIndex = '9999';
      banner.style.padding = '12px 18px';
      banner.style.background = '#f8d7da';
      banner.style.color = '#842029';
      banner.style.border = '1px solid #f5c2c7';
      banner.style.borderRadius = '6px';
      banner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
      banner.style.fontSize = '14px';
      banner.style.maxWidth = '90%';
      banner.style.textAlign = 'center';
      banner.style.wordWrap = 'break-word';
      document.body.appendChild(banner);
    }
    banner.textContent = message;
    clearTimeout(banner._timeout);
    banner._timeout = setTimeout(() => { banner.remove(); }, 5000);
  }

  // Evitar fallar si se abre por file://
  console.log('Script started — protocol:', location.protocol, 'PROXY_PHP=', PROXY_PHP);
  if (location.protocol === 'file:') {
    showErrorBanner('Sirve el proyecto por HTTP/HTTPS (php -S 0.0.0.0:8000 -t .) para que las llamadas funcionen.');
    console.warn('Detected file:// protocol — fetch will fail.');
    return;
  }

  // ---------- Leer machine.init (archivo en la misma ruta que index) ----------
  async function cargarMachineInit() {
    try {
      const res = await fetch("machine.init");
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      const txt = await res.text();
      // formato esperado: id=1  (o simplemente "1")
      const linea = txt.trim();
      if (!linea) return null;
      // aceptar ambos formatos: "id=1" o "1"
      if (linea.includes("=")) {
        const partes = linea.split("=");
        const id = parseInt(partes[1].trim());
        return Number.isNaN(id) ? null : id;
      } else {
        const id = parseInt(linea);
        return Number.isNaN(id) ? null : id;
      }
    } catch (err) {
      console.error("Error leyendo machine.init:", err);
      return null;
    }
  }

  // ---------- Helpers de URLs de imagen (corrige URLs mal formadas) ----------
  // Muchas respuestas contienen URLs como "...amazonaws.comproductos/..." sin la barra entre dominio y path.
  function fixImageUrl(raw) {
    if (!raw || typeof raw !== "string") return "";
    let url = raw.trim();

    // Si viene ya con espacio o query mal encodificada, limpiamos
    url = url.replace(/\s+/g, '');

    // Si no tiene esquema, intentar agregar https:// si parece venir de amazonaws o de vending-app-products
    if (!/^https?:\/\//i.test(url)) {
      // si comienza con vending-app..., asumir https://
      if (/vending-app-products\.s3\.us-east-2\.amazonaws\.com/i.test(url) || /amazonaws\.com/i.test(url)) {
        url = 'https://' + url;
      } else {
        // si es relativo no lo tocamos (retornamos vacío para usar placeholder)
        return "";
      }
    }

    // Reparar casos donde falta slash entre domain and path:
    // ejemplo: https://vending-app-products.s3.us-east-2.amazonaws.comproductos/...
    // detectar ".com" seguido de letra sin slash y poner "/"
    url = url.replace(/(\.amazonaws\.com)(?!(\/|:))/i, '$1/');
    url = url.replace(/(\.com)(?!(\/|:))/i, '$1/');

    // Reemplazar sequences de "DEFAULT_PRODUCT_IMAGE_PATH=" que algunas respuestas incluyen
    url = url.replace(/DEFAULT_PRODUCT_IMAGE_PATH=/g, '');

    // Si aún no parece una URL válida, devolver vacío
    if (!/^https?:\/\//i.test(url)) return "";
    return url;
  }

  // Construye URL para pedir recursos vía proxy.php (mismo origen)
  function proxyUrlFor(resourceUrl) {
    if (!resourceUrl) return "";
    return `${PROXY_PHP}${encodeURIComponent(resourceUrl)}`;
  }

  // ---------- API: obtener todos los productos desde la máquina ----------
  // Usamos proxy.php?url=... para evitar problemas CORS con el dominio remoto
  async function fetchStockMachineAll(machineId) {
    try {
      const apiUrl = `${STOCK_API_BASE}/getStockMachine?idMachine=${encodeURIComponent(machineId)}`;
      const urlProxy = `${PROXY_PHP}${encodeURIComponent(apiUrl)}`;
      const resp = await fetch(urlProxy);
      if (!resp.ok) {
        throw new Error("HTTP " + resp.status + " desde proxy para stockmachine");
      }
      const raw = await resp.json();
      // estructura esperada: { data: [ { machine: {...}, stock: [ ... ] } ] }
      return raw;
    } catch (err) {
      console.error("Error fetchStockMachineAll:", err);
      throw err;
    }
  }

  // Obtener stock por producto (si API soporta getStockMachine?idProduct=... se puede añadir)
  // Pero la API que vimos devuelve todo el stock en una sola llamada; este helper permite fallback.
  async function fetchStockForProduct(productId) {
    // si ya cacheado, devolver
    if (typeof stockByProduct[productId] !== "undefined") return stockByProduct[productId];

    if (!MACHINE_ID) {
      stockByProduct[productId] = 0;
      return 0;
    }

    try {
      // Intentamos la llamada específica si existe el endpoint con idProduct
      const apiUrl = `${STOCK_API_BASE}/getStockMachine?idProduct=${encodeURIComponent(productId)}&idMachine=${encodeURIComponent(MACHINE_ID)}`;
      const urlProxy = `${PROXY_PHP}${encodeURIComponent(apiUrl)}`;
      const resp = await fetch(urlProxy);
      if (!resp.ok) {
        // fallback: 0 (conservador)
        stockByProduct[productId] = 0;
        return 0;
      }
      const data = await resp.json();
      // La respuesta puede venir con distintos formatos; intentar varias rutas:
      // - { productInStock: n }
      // - { data: { ... } } similar
      let stock = 0;
      if (data === null || typeof data === "undefined") stock = 0;
      else if (typeof data === "number") stock = Number(data);
      else if (typeof data.productInStock !== "undefined") stock = Number(data.productInStock);
      else if (typeof data.data !== "undefined" && typeof data.data.productInStock !== "undefined") stock = Number(data.data.productInStock);
      else if (Array.isArray(data.data) && data.data.length && typeof data.data[0].generalStock !== "undefined") stock = Number(data.data[0].generalStock);
      else {
        // tomar primer número que aparezca en el objeto
        const firstNum = JSON.stringify(data).match(/"generalStock":\s*([0-9]+)/);
        stock = firstNum ? Number(firstNum[1]) : 0;
      }

      stock = Number.isNaN(stock) ? 0 : stock;
      stockByProduct[productId] = stock;
      return stock;
    } catch (err) {
      console.error("Error fetchStockForProduct:", err);
      stockByProduct[productId] = 0;
      return 0;
    }
  }

  // ---------- Precargar stock & transformar la respuesta de la máquina a productos ----------
  async function cargarProductosDesdeMaquina() {
    if (!MACHINE_ID) {
      showErrorBanner("No se pudo determinar el ID de máquina (machine.init). Los productos no se cargarán.");
      return;
    }

    try {
      const raw = await fetchStockMachineAll(MACHINE_ID);
      // raw puede ser { data: [ { stock: [ ... ] } ] } o directamente {stock: [...]}
      let stockArray = [];

      if (Array.isArray(raw)) {
        // caso improbable: la proxy devolvió un array directo
        // buscar dentro del array un elemento que tenga .stock
        const found = raw.find(r => r && Array.isArray(r.stock));
        if (found) stockArray = found.stock;
        else stockArray = raw; // intentar usarlo
      } else if (raw && Array.isArray(raw.data) && raw.data.length > 0 && Array.isArray(raw.data[0].stock)) {
        stockArray = raw.data[0].stock;
      } else if (raw && Array.isArray(raw.stock)) {
        stockArray = raw.stock;
      } else if (raw && raw.data && Array.isArray(raw.data)) {
        // si data es el arreglo de stock directamente
        stockArray = raw.data;
      } else {
        throw new Error("Respuesta inesperada de stockmachine");
      }

      // Transformar cada elemento de stockArray a nuestro formato de producto
      productosAPI = stockArray.map(item => {
        const pid = item.idProduct ?? item.id ?? item.productId;
        const nombre = item.name ?? item.nombre ?? item.productName ?? "";
        const desc = item.shortDescription ?? item.descripcionCorta ?? "";
        const precio = Number(item.unitPrice ?? item.precio ?? 0) || 0;
        const generalStock = Number(item.generalStock ?? item.stock ?? item.productInStock ?? 0) || 0;

        // categoría
        const categoriaNombre = item.category?.name ?? (item.categoryName ?? "sin-categoria");
        const categoriaImagenRaw = item.category?.image ?? item.categoryImage ?? "";
        const categoriaImagen = fixImageUrl(categoriaImagenRaw);

        // imagen producto (limpieza)
        const imageRaw = item.image ?? item.imageUrl ?? item.url ?? "";
        const imageFixed = fixImageUrl(imageRaw);

        // construir objeto del producto con campos que usa el script original
        const producto = {
          id: pid,
          nombre,
          descripcionCorta: desc,
          precio,
          machineStock: generalStock,
          imageUrl: imageFixed,
          category: {
            nombre: categoriaNombre,
            image: categoriaImagen
          }
        };

        // cachear stock
        stockByProduct[pid] = generalStock;

        return producto;
      });

      // Construir lista de categorías únicas desde stock
      const catMap = {};
      productosAPI.forEach(p => {
        const cname = (p.category?.nombre ?? "otros").toString().toLowerCase();
        if (!catMap[cname]) {
          catMap[cname] = {
            nombre: cname,
            imageUrl: p.category?.image || ""
          };
        }
      });
      categoriasAPI = Object.values(catMap);
      // construir mapa categoria name -> idName (en este caso usamos nombre)
      mapaCategoriasId = {};
      categoriasAPI.forEach((c, idx) => {
        mapaCategoriasId[c.nombre] = c.nombre; // simple
      });

      // finalmente pintar
      pintarCategorias();
      rellenarCards();

    } catch (err) {
      console.error("Error cargarProductosDesdeMaquina:", err);
      showErrorBanner("Error cargando productos desde la máquina. Revisa proxy.php o la conectividad.");
    }
  }

  // ---------- Cargar categorias (si se usara API separada) ----------
  // Para compatibilidad con tu código previo, mantenemos la función pero no la llamamos para categories remotas.
  async function cargarCategoriasAPI() {
    try {
      const resp = await fetch(`${API_PROXY}categorias`);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      categoriasAPI = data.categorias || data.data || data || [];
      mapaCategoriasId = {};
      categoriasAPI.forEach(cat => {
        if (cat.nombre) mapaCategoriasId[(cat.nombre || "").toLowerCase().trim()] = cat.nombre;
      });
      pintarCategorias();
    } catch (err) {
      console.warn("cargarCategoriasAPI fallo:", err);
    }
  }

  // ---------- PINTAR CATEGORIAS ----------
  function pintarCategorias() {
    const contenedor = document.getElementById("contenedorCategorias");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    // Botón TODOS
    const btnTodos = document.createElement("button");
    btnTodos.className = "btn-categoria active";
    btnTodos.dataset.catNombre = "todos";
    btnTodos.innerHTML = `<i class="bi bi-grid-fill me-2"></i> Todos`;
    contenedor.appendChild(btnTodos);

    // Botones a partir de categoriasAPI
    categoriasAPI.forEach(cat => {
      const btn = document.createElement("button");
      btn.className = "btn-categoria";
      btn.dataset.catNombre = (cat.nombre || "").toLowerCase().trim();
      const imgSrc = cat.imageUrl ? proxyUrlFor(cat.imageUrl) : '';
      btn.innerHTML = `
        <img src="${imgSrc}" class="icono-categoria me-2" alt="${cat.nombre || ''}" />
        ${cat.nombre || ''}
      `;
      contenedor.appendChild(btn);
    });

    activarEventosCategorias();
  }

  function activarEventosCategorias() {
    document.querySelectorAll(".btn-categoria").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".btn-categoria").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        categoriaActiva = btn.dataset.catNombre || "todos";
        rellenarCards();
      });
    });
  }

  // ---------- RELLENAR CARDS ----------
  function rellenarCards() {
    const cardsGrid = document.querySelector(".cards-grid");
    if (!cardsGrid) return;

    let productosFiltrados = productosAPI;
    if (categoriaActiva !== "todos") {
      productosFiltrados = productosAPI.filter(p => (p.category?.nombre ?? '').toString().toLowerCase() === categoriaActiva);
    }

    cardsGrid.innerHTML = "";

    productosFiltrados.forEach((producto) => {
      const card = document.createElement("div");
      card.className = "card Card-Product-Preview";

      // wrapper para posicionar badge
      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";

      const imagen = document.createElement("img");
      imagen.className = "card-img-top";
      const imagenUrl = producto.imageUrl || "";
      imagen.setAttribute("src", imagenUrl ? proxyUrlFor(imagenUrl) : "");
      imagen.setAttribute("alt", producto.nombre || "Producto");
      wrapper.appendChild(imagen);

      // badge stock
      const stockBadge = document.createElement("div");
      stockBadge.style.position = "absolute";
      stockBadge.style.left = "12px";
      stockBadge.style.top = "12px";
      stockBadge.style.background = "rgba(0,0,0,0.6)";
      stockBadge.style.color = "white";
      stockBadge.style.padding = "4px 8px";
      stockBadge.style.borderRadius = "12px";
      stockBadge.style.fontSize = "12px";
      stockBadge.textContent = typeof producto.machineStock !== "undefined" ? `Stock: ${producto.machineStock}` : "";
      if (typeof producto.machineStock !== "undefined") wrapper.appendChild(stockBadge);

      const cardBody = document.createElement("div");
      cardBody.className = "card-body text-center";

      const precio = document.createElement("h5");
      precio.className = "precio";
      const precioNum = Number(producto.precio || producto.unitPrice || 0);
      precio.textContent = `Q ${isNaN(precioNum) ? "0.00" : precioNum.toFixed(2)}`;

      const descripcion = document.createElement("p");
      descripcion.className = "nombre-producto";
      descripcion.textContent = producto.descripcionCorta || producto.nombre || "";

      const btn = document.createElement("button");
      btn.className = "btn btn-dark rounded-pill px-4 py-2";
      btn.textContent = "Añadir";

      cardBody.appendChild(precio);
      cardBody.appendChild(descripcion);
      cardBody.appendChild(btn);

      card.appendChild(wrapper);
      card.appendChild(cardBody);

      // datos para recuperar
      card.dataset.productId = producto.id ?? "";
      card.dataset.productoOriginal = JSON.stringify(producto);

      cardsGrid.appendChild(card);
    });

    agregarEventListenersCards();
  }

  // ---------- EVENT LISTENERS PARA CARDS ----------
  function agregarEventListenersCards() {
    // clonar nodos para limpiar listeners
    document.querySelectorAll(".Card-Product-Preview").forEach(card => {
      card.replaceWith(card.cloneNode(true));
    });

    document.querySelectorAll(".Card-Product-Preview").forEach(card => {
      const btn = card.querySelector(".btn-dark");

      if (btn) {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();

          const productoCompleto = card.dataset.productoOriginal ? JSON.parse(card.dataset.productoOriginal) : null;
          const pid = productoCompleto?.id ?? productoCompleto?._id;

          // refrescar stock desde API (garantizar)
          const stock = await fetchStockForProduct(pid);
          productoCompleto.machineStock = stock;

          // cantidad actualmente en carrito
          const existente = carrito.find(c => String(c.id) === String(pid));
          const cantidadEnCarrito = existente ? existente.cantidad : 0;
          const disponible = productoCompleto.machineStock - cantidadEnCarrito;

          if (disponible <= 0) {
            mostrarModalNoDisponible(productoCompleto.nombre || "Producto");
            return;
          }

          // agregar 1 unidad (control interno)
          await agregarProducto(productoCompleto, 1);
        });
      }

      card.addEventListener("click", (e) => {
        if (e.target.closest(".btn-dark")) return;

        const productoCompleto = card.dataset.productoOriginal ? JSON.parse(card.dataset.productoOriginal) : null;
        const descripcion = productoCompleto?.descripcionLarga || productoCompleto?.descripcionCorta || productoCompleto?.shortDescription || "Producto";

        modalDetalle.querySelector("#modalNombre").textContent = productoCompleto?.nombre || productoCompleto?.name || card.querySelector(".nombre-producto").textContent;
        // precio formateado
        const priceVal = Number(productoCompleto?.precio ?? productoCompleto?.unitPrice ?? 0);
        modalDetalle.querySelector("#modalPrecio").textContent = `Q ${isNaN(priceVal) ? "0.00" : priceVal.toFixed(2)}`;

        // imagen en modal: usar proxy si existe
        const imagenField = productoCompleto?.imageUrl || productoCompleto?.image || productoCompleto?.imagen || "";
        const imgSrc = imagenField ? proxyUrlFor(imagenField) : card.querySelector("img").src;
        modalDetalle.querySelector("#modalImagen").src = imgSrc || "";

        modalDetalle.querySelector("#modalDescripcion").textContent = descripcion;

        // guardar producto en dataset
        modalDetalle.dataset.producto = JSON.stringify(productoCompleto || {});
        modalDetalle.classList.add("mostrar");
      });
    });
  }

  // ---------- MODAL NO DISPONIBLE ----------
  function mostrarModalNoDisponible(nombreProducto) {
    let m = document.getElementById("modalNoDisponible");
    if (!m) {
      m = document.createElement("div");
      m.id = "modalNoDisponible";
      m.className = "modal-detalle";
      m.innerHTML = `
        <div class="modal-content modal-detalle-producto">
          <div class="modal-detalle-header">Producto no disponible</div>
          <div class="modal-detalle-body">
            <i class="bi bi-exclamation-circle" style="font-size: 3rem; color: #dc3545;"></i>
            <h3 style="margin-top: 20px; color: #333;">No disponible por el momento</h3>
            <p style="color: #666;" id="modalNoDispMsg">El producto seleccionado no está disponible en esta máquina.</p>
          </div>
          <div class="modal-detalle-footer">
            <button class="btn btn-dark modal-btn-volver" id="cerrarNoDisponible">Entendido</button>
          </div>
        </div>
      `;
      document.body.appendChild(m);
      m.querySelector("#cerrarNoDisponible").addEventListener("click", () => {
        m.classList.remove("mostrar");
      });
    }
    const msg = m.querySelector("#modalNoDispMsg");
    msg.textContent = `Lo sentimos — "${nombreProducto}" no está disponible en esta máquina en este momento.`;
    m.classList.add("mostrar");
  }

  // ---------- Cerrar modales ----------
  function cerrarTodosLosModales() {
    modalDetalle.classList.remove("mostrar");
    modalCarrito.classList.remove("mostrar");
    modalPago.classList.remove("mostrar");
    modalCarritoVacio.classList.remove("mostrar");
    const mn = document.getElementById("modalNoDisponible");
    if (mn) mn.classList.remove("mostrar");
  }

  // ---------- Validar carrito ----------
  function validarCarritoNoVacio() {
    if (carrito.length === 0) {
      cerrarTodosLosModales();
      modalCarritoVacio.classList.add("mostrar");
      return false;
    }
    return true;
  }

  // ---------- Inicialización ----------
  (async () => {
    MACHINE_ID = await cargarMachineInit();
    if (!MACHINE_ID) {
      showErrorBanner("No se pudo leer el número de máquina desde machine.init. Edita machine.init con el ID (ej. id=1).");
      // intentar seguir: se detiene la carga de productos desde máquina
    } else {
      console.log("MACHINE_ID cargado:", MACHINE_ID);
      await cargarProductosDesdeMaquina();
    }
  })();

  // ---------- Popup agregado ----------
  function mostrarPopup() {
    popup.classList.add("popup-show");
    setTimeout(() => popup.classList.remove("popup-show"), 1800);
  }

  // ---------- Actualizar totales ----------
function actualizarTotales() {
  total = carrito.reduce((acc, it) => acc + (Number(it.precio) || 0), 0);
  txtContador.textContent = String(carrito.length);
  txtTotal.textContent = `Q${total.toFixed(2)}`;
}

  // ---------- Agregar producto al carrito (con control de stock) ----------
async function agregarProducto(productoCompleto, cantidad = 1) {
    if (!productoCompleto) return;
    const pid = productoCompleto.id ?? productoCompleto._id;

    // Obtener stock actualizado
    const stock = await fetchStockForProduct(pid);
    productoCompleto.machineStock = stock;

    // Cuántos de este producto ya están en el carrito (como ítems separados)
    const agregados = carrito.filter(p => String(p.id) === String(pid)).length;

    if (stock - agregados <= 0) {
        mostrarModalNoDisponible(productoCompleto.nombre || "Producto");
        return;
    }

    // Agregar N items individuales
    for (let i = 0; i < cantidad; i++) {
        carrito.push({
            id: pid,
            nombre: productoCompleto.nombre,
            precio: Number(productoCompleto.precio || 0),
            imagen: productoCompleto.imageUrl ? proxyUrlFor(productoCompleto.imageUrl) : "",
            productoCompleto
        });
    }

    actualizarTotales();
    mostrarPopup();
}

  // ---------- Listeners modal detalle (añadir / cerrar) ----------
  if (btnCerrarModal) {
    btnCerrarModal.addEventListener("click", () => modalDetalle.classList.remove("mostrar"));
  }

  if (btnAgregarModal) {
    btnAgregarModal.addEventListener("click", async () => {
      const productoStr = modalDetalle.dataset.producto;
      const producto = productoStr ? JSON.parse(productoStr) : null;
      if (!producto) return modalDetalle.classList.remove("mostrar");
      await agregarProducto(producto, 1);
      modalDetalle.classList.remove("mostrar");
    });
  }

  // ---------- Renderizar carrito ----------
function renderizarCarrito() {
    listaCarrito.innerHTML = "";

    if (carrito.length === 0) {
        listaCarrito.innerHTML = "<p class='text-center text-muted'>No hay productos en el carrito.</p>";
        totalCarritoModal.textContent = "Q0.00";
        return;
    }

    carrito.forEach((prod, index) => {
        const item = document.createElement("div");
        item.classList.add("item-carrito");

        item.innerHTML = `
            <div class="item-info">
                <img src="${prod.imagen || ''}">
                <div class="item-textos">
                    <h4 class="precio-rojo">Q${prod.precio.toFixed(2)}</h4>
                    <p class="nombre-item">${prod.nombre}</p>
                </div>
            </div>

            <button class="btn-eliminar" data-index="${index}">
                <i class="bi bi-trash"></i> Eliminar
            </button>
        `;

        listaCarrito.appendChild(item);
    });

    totalCarritoModal.textContent = `Q${total.toFixed(2)}`;
}


  // ---------- Abrir carrito ----------
  if (btnCarrito) {
    btnCarrito.addEventListener("click", () => {
      cerrarTodosLosModales();
      renderizarCarrito();
      modalCarrito.classList.add("mostrar");
    });
  }

  // ---------- Cerrar carrito ----------
  if (btnCerrarCarrito) {
    btnCerrarCarrito.addEventListener("click", () => modalCarrito.classList.remove("mostrar"));
  }

  // ---------- Manejo clicks dentro de listaCarrito (eliminar, inc, dec) ----------
listaCarrito.addEventListener("click", (e) => {
    const btnEliminar = e.target.closest(".btn-eliminar");
    if (btnEliminar) {
        const index = Number(btnEliminar.dataset.index);
        if (!isNaN(index)) {
            carrito.splice(index, 1);
            actualizarTotales();
            renderizarCarrito();
        }
    }
});

  // ---------- Render pago ----------
  function renderizarPago() {
    listaPago.innerHTML = "";

    carrito.forEach(prod => {
      const item = document.createElement("div");
      item.classList.add("item-pago");

      item.innerHTML = `
        <div class="item-info">
          <img src="${prod.imagen || ''}">
          <div class="item-textos">
            <h4 class="precio-rojo">Q${((Number(prod.precio) || 0)).toFixed(2)}</h4>
            <p class="nombre-item">${prod.nombre}</p>
          </div>
        </div>
      `;

      listaPago.appendChild(item);
    });

    totalPago.textContent = `Q${total.toFixed(2)}`;
  }

  // ---------- Boton pagar desde footer ----------
  if (btnPagar) {
    btnPagar.addEventListener("click", () => {
      if (!validarCarritoNoVacio()) return;
      cerrarTodosLosModales();
      renderizarPago();
      modalPago.classList.add("mostrar");
    });
  }

  if (btnCerrarPago) {
    btnCerrarPago.addEventListener("click", () => modalPago.classList.remove("mostrar"));
  }

  if (btnCerrarModalCarritoVacio) {
    btnCerrarModalCarritoVacio.addEventListener("click", () => modalCarritoVacio.classList.remove("mostrar"));
  }

  // ---------- POS y QR modals ----------
  const modalPOS = document.getElementById("modalPOS");
  const btnPagarTarjeta = document.getElementById("btnPagarTarjeta");
  const btnPagarQR = document.getElementById("btnPagarQR");
  const cerrarPOS = document.getElementById("cerrarPOS");
  if (cerrarPOS) cerrarPOS.addEventListener("click", () => modalPOS.classList.remove("mostrar"));
  const cerrarQR = document.getElementById("cerrarQR");
  if (cerrarQR) cerrarQR.addEventListener("click", () => modalQR.classList.remove("mostrar"));

  // botones que muestran POS (lista incluye #continuarPagoCarrito en tu HTML)
  document.querySelectorAll("#continuarPagoCarrito, #modalCarrito .btn-pago-qr").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!validarCarritoNoVacio()) return;
      cerrarTodosLosModales();
      renderizarPago();
      modalPago.classList.add("mostrar");
    });
  });

  // ---------- Confirmar venta (envío al backend y actualizar stock local) ----------
  async function confirmarVenta(metodoPago) {
    if (!validarCarritoNoVacio()) return;

    // preparar detalles
    const detalles = carrito.map(it => ({ idProducto: Number(it.id), cantidad: Number(it.cantidad) }));
    const payload = {
      idMaquina: MACHINE_ID,
      metodoPago,
      detalles
    };

    // Intentar enviar al proxy ventas (si existe) o mostrar banner si no
    const ventasEndpointProxy = `${API_PROXY}ventas`; // solo útil si tu api.php soporta esa ruta
    try {
      let resp = await fetch(ventasEndpointProxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      // si proxy 404 o falla intentar ruta remota alternativa (no garantizada por CORS),
      // preferimos usar proxy.php para una URL remota completa si tu backend no tiene api.php route.
      if (!resp.ok) {
        // construir llamado remoto completo (ejemplo) y usar proxy.php para evitar CORS
        const remoteVentaUrl = `https://valentin.jbcomputers.com.gt/api/v1/ventas`;
        const proxyUrl = `${PROXY_PHP}${encodeURIComponent(remoteVentaUrl)}`;
        resp = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error("Error al registrar venta: " + resp.status + " " + txt);
      }

      // éxito: actualizar stock local
      for (const it of carrito) {
        const currentStock = (typeof stockByProduct[it.id] === "number") ? stockByProduct[it.id] : (it.productoCompleto?.machineStock ?? 0);
        const newStock = Math.max(0, currentStock - it.cantidad);
        stockByProduct[it.id] = newStock;
        const prodInApi = productosAPI.find(p => String(p.id) === String(it.id));
        if (prodInApi) prodInApi.machineStock = newStock;
      }

      carrito = [];
      actualizarTotales();
      cerrarTodosLosModales();
      showSuccessAfterPayment(metodoPago);

      // volver a renderizar cards para actualizar badges de stock
      rellenarCards();

    } catch (err) {
      console.error("Error confirmarVenta:", err);
      showErrorBanner("No se pudo completar la venta: " + (err.message || err));
    }
  }

  // ---------- Hooks botones pagar en modalPago ----------
  if (btnPagarTarjeta) {
    btnPagarTarjeta.addEventListener("click", async () => {
      // revalidar stock
      for (const it of carrito) {
        const stock = await fetchStockForProduct(it.id);
        if (stock < it.cantidad) {
          mostrarModalNoDisponible(it.nombre);
          return;
        }
      }
      // mostrar POS y confirmar venta tras pequeña espera
      cerrarTodosLosModales();
      modalPOS.classList.add("mostrar");
      setTimeout(async () => {
        modalPOS.classList.remove("mostrar");
        await confirmarVenta("TC");
      }, 700);
    });
  }

  if (btnPagarQR) {
    btnPagarQR.addEventListener("click", async () => {
      for (const it of carrito) {
        const stock = await fetchStockForProduct(it.id);
        if (stock < it.cantidad) {
          mostrarModalNoDisponible(it.nombre);
          return;
        }
      }
      cerrarTodosLosModales();
      const modalQR = document.getElementById("modalQR");
      modalQR.classList.add("mostrar");
      setTimeout(async () => {
        modalQR.classList.remove("mostrar");
        await confirmarVenta("QR");
      }, 700);
    });
  }

  // ---------- Mensaje de éxito ----------
  function showSuccessAfterPayment(metodo) {
    popup.textContent = "Venta confirmada ✅";
    popup.classList.add("popup-show");
    setTimeout(() => {
      popup.classList.remove("popup-show");
      popup.innerHTML = '<i class="bi bi-check-circle-fill"></i> Producto agregado';
    }, 1800);
  }

  // ---------- Cierre modal carrito vacío ----------
  if (btnCerrarModalCarritoVacio) {
    btnCerrarModalCarritoVacio.addEventListener("click", () => modalCarritoVacio.classList.remove("mostrar"));
  }

  // ---------- Exposición para debug en consola ----------
  window.__vm_debug = {
    getState: () => ({ carrito, productosAPI, categoriasAPI, stockByProduct, MACHINE_ID }),
    recalculate: actualizarTotales
  };

});
