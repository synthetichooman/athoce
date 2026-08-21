(() => {
  const EDITORIAL_COUNT = 13;
  const IDLE_RESET_MS = 90_000;
  const LOGO_PATHS = [
    "M32.9,2.5c-9.6,0-17.4,8.1-17,17.8.4,8.8,7.5,15.9,16.3,16.3,0,0,.1,0,.2,0,5,.2,9,4.2,9,9.2v36.6h8.7V19.9c0-9.5-7.7-17.4-17.2-17.4Z",
    "M70.8,2.5c-9.6,0-17.4,8.1-17,17.8.4,8.8,7.5,15.9,16.3,16.3,0,0,.1,0,.2,0,5,.2,9,4.2,9,9.2v36.6h8.7V19.9c0-9.5-7.7-17.4-17.2-17.4Z",
    "M108.6,2.5c-9.6,0-17.4,8.1-17,17.8.4,8.8,7.5,15.9,16.3,16.3,0,0,.1,0,.2,0,5,.2,9,4.2,9,9.2v36.6h8.7V19.9c0-9.5-7.7-17.4-17.2-17.4Z",
  ];
  const LOGO_STATES = {
    intro: { active: "all", tone: "dark" },
    aategois: { active: "1", tone: "dark" },
    hooman: { active: "2", tone: "dark" },
    cementbay: { active: "3", tone: "dark" },
    credit: { active: "all", tone: "light" },
  };

  const shops = [
    {
      id: "aategois",
      model: "가영",
      looks: [
        {
          id: "aategois-01",
          look: "01",
          role: "editorial",
          image: "./assets/images/looks/aategois-01.webp",
          fallback: "./assets/images/editorial/editorial-02.webp",
          brands: {},
        },
        {
          id: "aategois-02",
          look: "02",
          role: "editorial",
          image: "./assets/images/looks/aategois-02.webp",
          fallback: "./assets/images/editorial/editorial-03.webp",
          brands: {},
        },
        {
          id: "aategois-exhibition",
          look: "03",
          role: "exhibition",
          image: "./assets/images/looks/aategois-exhibition.webp?v=20260821",
          fallback: "./assets/images/editorial/editorial-04.webp",
          brands: {},
        },
      ],
    },
    {
      id: "hooman",
      model: "유민",
      looks: [
        {
          id: "hooman-01",
          look: "01",
          role: "editorial",
          image: "./assets/images/looks/hooman-01.webp",
          fallback: "./assets/images/editorial/editorial-05.webp",
          brands: {
            top: ["kenzo jungle"],
            bottom: ["emporio armani"],
            acc: ["belt", "prada"],
            shoes: ["puma", "japandal"],
          },
        },
        {
          id: "hooman-02",
          look: "02",
          role: "editorial",
          image: "./assets/images/looks/hooman-02.webp",
          fallback: "./assets/images/editorial/editorial-06.webp",
          brands: {},
        },
        {
          id: "hooman-exhibition",
          look: "03",
          role: "exhibition",
          image: "./assets/images/looks/hooman-exhibition.webp?v=20260821",
          fallback: "./assets/images/editorial/editorial-07.webp",
          brands: {},
        },
      ],
    },
    {
      id: "cementbay",
      model: "세연",
      looks: [
        {
          id: "cementbay-01",
          look: "01",
          role: "editorial",
          image: "./assets/images/looks/cementbay-01.webp?v=20260821",
          fallback: "./assets/images/editorial/editorial-07.webp",
          brands: {},
        },
        {
          id: "cementbay-02",
          look: "02",
          role: "editorial",
          image: "./assets/images/looks/cementbay-02.webp",
          fallback: "./assets/images/editorial/editorial-09.webp",
          brands: {},
        },
        {
          id: "cementbay-exhibition",
          look: "03",
          role: "exhibition",
          image: "./assets/images/looks/cementbay-exhibition.webp?v=20260821",
          fallback: "./assets/images/editorial/editorial-08.webp",
          brands: {},
        },
      ],
    },
  ];

  const screenOrder = ["intro", ...shops.map((shop) => shop.id), "credit"];
  const exhibition = document.querySelector("#exhibition");
  const editorialRail = document.querySelector("#editorialRail");
  const editorialList = document.querySelector("#editorialList");
  const editorialCounter = document.querySelector("#editorialCounter");
  const pageLogo = document.querySelector("#pageLogo");

  let activeEditorialIndex = 0;
  let activeLogoScreenIndex = -1;
  let activeLogoLayerIndex = 0;
  let logoLayers = [];
  let selectedLookId = "";
  let editorialFrame = 0;
  let horizontalFrame = 0;
  let idleResetTimer = 0;

  function editorialPath(index) {
    return `./assets/images/editorial/editorial-${String(index + 1).padStart(2, "0")}.webp`;
  }

  function createLogoLayer() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("page-logo-layer");
    svg.setAttribute("viewBox", "0 0 141.7 85");
    svg.setAttribute("focusable", "false");

    LOGO_PATHS.forEach((pathData) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.append(path);
    });

    return svg;
  }

  function setLogoLayerState(layer, screenIndex) {
    const state = LOGO_STATES[screenOrder[screenIndex]] ?? LOGO_STATES.intro;
    layer.classList.toggle("is-light", state.tone === "light");
    layer.querySelectorAll("path").forEach((path, index) => {
      path.classList.toggle("is-filled", state.active === "all" || state.active === String(index + 1));
    });
  }

  function makePageLogo() {
    logoLayers = [createLogoLayer(), createLogoLayer()];
    activeLogoScreenIndex = currentScreenIndex();
    setLogoLayerState(logoLayers[0], activeLogoScreenIndex);
    logoLayers[0].classList.add("is-visible");
    pageLogo.replaceChildren(...logoLayers);
  }

  function updatePageLogo(screenIndex) {
    if (screenIndex === activeLogoScreenIndex) return;

    const nextLayerIndex = activeLogoLayerIndex === 0 ? 1 : 0;
    const currentLayer = logoLayers[activeLogoLayerIndex];
    const nextLayer = logoLayers[nextLayerIndex];

    setLogoLayerState(nextLayer, screenIndex);
    nextLayer.classList.add("is-visible");
    currentLayer.classList.remove("is-visible");
    activeLogoLayerIndex = nextLayerIndex;
    activeLogoScreenIndex = screenIndex;
  }

  function makeEditorialSlides() {
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < EDITORIAL_COUNT; index += 1) {
      const slide = document.createElement("figure");
      slide.className = "editorial-slide";
      slide.dataset.index = String(index);

      const image = document.createElement("img");
      image.alt = `3² editorial ${String(index + 1).padStart(2, "0")}`;
      image.decoding = "async";
      image.draggable = false;
      image.dataset.src = editorialPath(index);
      image.addEventListener("load", () => image.classList.add("is-loaded"));

      slide.append(image);
      fragment.append(slide);
    }

    editorialList.replaceChildren(fragment);
    updateEditorialWindow(0);
  }

  function updateEditorialWindow(index) {
    const images = [...editorialList.querySelectorAll("img")];

    images.forEach((image, imageIndex) => {
      const distance = Math.abs(imageIndex - index);

      if (distance <= 1) {
        if (!image.getAttribute("src")) image.src = image.dataset.src;
        return;
      }

      if (distance > 2 && image.getAttribute("src")) {
        image.classList.remove("is-loaded");
        image.removeAttribute("src");
      }
    });
  }

  function updateEditorialIndex() {
    const nextIndex = Math.max(
      0,
      Math.min(EDITORIAL_COUNT - 1, Math.round(editorialRail.scrollTop / editorialRail.clientHeight)),
    );

    if (nextIndex === activeEditorialIndex) return;

    activeEditorialIndex = nextIndex;
    editorialCounter.textContent = `${String(nextIndex + 1).padStart(2, "0")} / ${EDITORIAL_COUNT}`;
    updateEditorialWindow(nextIndex);
  }

  function makeLookCard(shop, look) {
    const card = document.createElement("button");
    card.className = "look-card";
    card.type = "button";
    card.dataset.lookId = look.id;
    card.dataset.lookRole = look.role;
    card.setAttribute("aria-pressed", "false");
    card.setAttribute(
      "aria-label",
      `${shop.id} ${shop.model} ${look.role === "editorial" ? "에디토리얼" : "전시 추가"} 착장 ${look.look}`,
    );

    const imageWrap = document.createElement("span");
    imageWrap.className = "look-image";

    const image = document.createElement("img");
    image.src = look.image;
    image.alt = `${shop.model} 착장 ${look.look}`;
    image.decoding = "async";
    image.draggable = false;
    image.addEventListener("error", () => {
      if (image.dataset.fallbackApplied === "true") return;
      image.dataset.fallbackApplied = "true";
      image.classList.add("is-fallback");
      image.src = look.fallback;
    });

    imageWrap.append(image);

    const label = document.createElement("span");
    label.className = "look-label";
    label.textContent = `${shop.model} - ${look.look}`;

    card.append(imageWrap, label);
    card.addEventListener("click", () => selectLook(look.id));
    return card;
  }

  function makeLookPreview(shop) {
    const preview = document.createElement("button");
    preview.className = "selected-look-preview";
    preview.type = "button";
    preview.dataset.lookPreview = "";
    preview.setAttribute("aria-hidden", "true");
    preview.tabIndex = -1;

    const imageWrap = document.createElement("span");
    imageWrap.className = "selected-look-image";

    const image = document.createElement("img");
    image.decoding = "async";
    image.draggable = false;
    image.addEventListener("error", () => {
      if (image.dataset.fallbackApplied === "true" || !image.dataset.fallback) return;
      image.dataset.fallbackApplied = "true";
      image.classList.add("is-fallback");
      image.src = image.dataset.fallback;
    });

    imageWrap.append(image);
    preview.append(imageWrap);
    preview.addEventListener("click", clearLook);
    preview.setAttribute("aria-label", `${shop.model} 선택 해제`);
    return preview;
  }

  function makeLookCards() {
    shops.forEach((shop) => {
      const screen = document.querySelector(`[data-shop="${shop.id}"]`);
      const grid = screen?.querySelector("[data-look-grid]");
      if (!grid) return;
      grid.replaceChildren(...shop.looks.map((look) => makeLookCard(shop, look)));

      const stage = grid.closest(".shop-look-stage");
      if (!screen.querySelector("[data-look-preview]")) {
        stage.insertAdjacentElement("afterend", makeLookPreview(shop));
      }
    });
  }

  function updateLookPreview(screen, shop, look) {
    const preview = screen.querySelector("[data-look-preview]");
    const image = preview?.querySelector("img");
    if (!preview || !image) return;

    image.dataset.fallbackApplied = "false";
    image.dataset.fallback = look.fallback;
    image.classList.remove("is-fallback");
    image.alt = `${shop.model} 착장 ${look.look}`;
    image.src = look.image;
    preview.setAttribute("aria-label", `${shop.model} - ${look.look} 선택 해제`);
    preview.setAttribute("aria-hidden", "false");
    preview.tabIndex = 0;
  }

  function renderBrands(screen, brands = {}) {
    const brandList = screen.querySelector("[data-brand-list]");
    const labels = [
      ["top", "top"],
      ["bottom", "bottom"],
      ["acc", "acc"],
      ["shoes", "shoes"],
    ];

    brandList.replaceChildren(
      ...labels.map(([key, label]) => {
        const group = document.createElement("div");
        group.className = "brand-item";

        const term = document.createElement("dt");
        term.textContent = label;
        group.append(term);

        const values = Array.isArray(brands[key]) ? brands[key] : [];
        if (!values.length) {
          const value = document.createElement("dd");
          value.className = "brand-empty";
          value.textContent = "—";
          group.append(value);
        } else {
          values.forEach((brand) => {
            const value = document.createElement("dd");
            value.textContent = brand;
            group.append(value);
          });
        }

        return group;
      }),
    );
  }

  function findLook(id) {
    for (const shop of shops) {
      const lookIndex = shop.looks.findIndex((look) => look.id === id);
      if (lookIndex >= 0) return { shop, look: shop.looks[lookIndex], lookIndex };
    }
    return null;
  }

  function selectLook(id) {
    if (selectedLookId === id) {
      clearLook();
      return;
    }

    const match = findLook(id);
    if (!match) return;

    clearLook();
    selectedLookId = id;

    const { shop, look, lookIndex } = match;
    const screen = document.querySelector(`[data-shop="${shop.id}"]`);
    const lookInfo = screen.querySelector("[data-look-info]");
    const lookName = screen.querySelector("[data-look-name]");
    const lookNumber = screen.querySelector("[data-look-number]");

    updateLookPreview(screen, shop, look);
    screen.classList.add("has-selection");
    screen.classList.toggle("has-exhibition-selection", look.role === "exhibition");
    lookInfo.setAttribute("aria-hidden", "false");
    lookName.textContent = `${shop.model} - ${look.look}`;
    lookNumber.textContent = `${String(lookIndex + 1).padStart(2, "0")} / ${String(shop.looks.length).padStart(2, "0")}`;
    renderBrands(screen, look.brands);

    screen.querySelectorAll(".look-card").forEach((card) => {
      const isSelected = card.dataset.lookId === id;
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function clearLook() {
    selectedLookId = "";
    document.querySelectorAll(".shop-screen").forEach((screen) => {
      screen.classList.remove("has-selection", "has-exhibition-selection");
      screen.querySelector("[data-look-info]")?.setAttribute("aria-hidden", "true");
      const preview = screen.querySelector("[data-look-preview]");
      preview?.setAttribute("aria-hidden", "true");
      if (preview) preview.tabIndex = -1;
      screen.querySelectorAll(".look-card").forEach((card) => {
        card.classList.remove("is-selected");
        card.setAttribute("aria-pressed", "false");
      });
    });
  }

  function goToScreen(screenId) {
    const target = document.querySelector(`#${screenId}`);
    if (!target) return;
    clearLook();
    target.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function currentScreenIndex() {
    return Math.max(
      0,
      Math.min(screenOrder.length - 1, Math.round(exhibition.scrollLeft / window.innerWidth)),
    );
  }

  function resetExhibition() {
    clearLook();
    const exhibitionScrollBehavior = exhibition.style.scrollBehavior;
    const editorialScrollBehavior = editorialRail.style.scrollBehavior;

    exhibition.style.scrollBehavior = "auto";
    editorialRail.style.scrollBehavior = "auto";
    exhibition.scrollLeft = 0;
    editorialRail.scrollTop = 0;
    activeEditorialIndex = 0;
    editorialCounter.textContent = `01 / ${EDITORIAL_COUNT}`;
    updateEditorialWindow(0);
    updatePageLogo(0);
    document.activeElement?.blur();

    window.requestAnimationFrame(() => {
      exhibition.style.scrollBehavior = exhibitionScrollBehavior;
      editorialRail.style.scrollBehavior = editorialScrollBehavior;
    });
  }

  function scheduleIdleReset() {
    window.clearTimeout(idleResetTimer);
    idleResetTimer = window.setTimeout(resetExhibition, IDLE_RESET_MS);
  }

  function selectAdjacentLook(direction) {
    const match = findLook(selectedLookId);
    if (!match) return;
    const nextIndex = Math.max(0, Math.min(match.shop.looks.length - 1, match.lookIndex + direction));
    if (nextIndex === match.lookIndex) return;
    selectLook(match.shop.looks[nextIndex].id);
  }

  editorialRail.addEventListener("scroll", () => {
    cancelAnimationFrame(editorialFrame);
    editorialFrame = requestAnimationFrame(updateEditorialIndex);
  });

  exhibition.addEventListener("scroll", () => {
    cancelAnimationFrame(horizontalFrame);
    horizontalFrame = requestAnimationFrame(() => {
      updatePageLogo(currentScreenIndex());
      if (!selectedLookId) return;
      const match = findLook(selectedLookId);
      const selectedIndex = screenOrder.indexOf(match?.shop.id);
      if (Math.abs(exhibition.scrollLeft / window.innerWidth - selectedIndex) > 0.35) clearLook();
    });
  });

  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => goToScreen(button.dataset.screen));
  });

  document.querySelectorAll(".look-close").forEach((button) => {
    button.addEventListener("click", clearLook);
  });

  document.addEventListener("keydown", (event) => {
    const screenIndex = currentScreenIndex();
    const onIntro = screenIndex === 0;

    if (event.key === "Escape" && selectedLookId) {
      clearLook();
      return;
    }

    if (!onIntro && selectedLookId && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      selectAdjacentLook(event.key === "ArrowRight" ? 1 : -1);
      return;
    }

    if (!selectedLookId && event.key === "ArrowRight" && screenIndex < screenOrder.length - 1) {
      goToScreen(screenOrder[screenIndex + 1]);
    }
    if (!selectedLookId && event.key === "ArrowLeft" && screenIndex > 0) {
      goToScreen(screenOrder[screenIndex - 1]);
    }

    if (onIntro && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      editorialRail.scrollTo({
        top: (activeEditorialIndex + direction) * editorialRail.clientHeight,
        behavior: "smooth",
      });
    }
  });

  ["pointerdown", "pointermove", "wheel", "touchstart", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, scheduleIdleReset, { passive: true });
  });

  makePageLogo();
  makeEditorialSlides();
  makeLookCards();
  scheduleIdleReset();
})();
