(() => {
  const EDITORIAL_COUNT = 13;

  const shops = [
    {
      id: "aategois",
      model: "유민",
      looks: [
        {
          id: "yumin-01",
          look: "01",
          role: "editorial",
          image: "./assets/images/looks/yumin-01.webp",
          fallback: "./assets/images/editorial/editorial-02.webp",
          brands: {
            top: ["kenzo jungle"],
            bottom: ["emporio armani"],
            acc: ["belt", "prada"],
            shoes: ["puma", "japandal"],
          },
        },
        {
          id: "yumin-02",
          look: "02",
          role: "editorial",
          image: "./assets/images/looks/yumin-02.webp",
          fallback: "./assets/images/editorial/editorial-03.webp",
          brands: {},
        },
        {
          id: "aategois-exhibition",
          look: "03",
          role: "exhibition",
          image: "./assets/images/looks/aategois-exhibition.webp",
          fallback: "./assets/images/editorial/editorial-04.webp",
          brands: {},
        },
      ],
    },
    {
      id: "hooman",
      model: "가영",
      looks: [
        {
          id: "gayoung-01",
          look: "01",
          role: "editorial",
          image: "./assets/images/looks/gayoung-01.webp",
          fallback: "./assets/images/editorial/editorial-05.webp",
          brands: {},
        },
        {
          id: "gayoung-02",
          look: "02",
          role: "editorial",
          image: "./assets/images/looks/gayoung-02.webp",
          fallback: "./assets/images/editorial/editorial-06.webp",
          brands: {},
        },
        {
          id: "hooman-exhibition",
          look: "03",
          role: "exhibition",
          image: "./assets/images/looks/hooman-exhibition.webp",
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
          id: "seyeon-01",
          look: "01",
          role: "editorial",
          image: "./assets/images/looks/seyeon-01.webp",
          fallback: "./assets/images/editorial/editorial-07.webp",
          brands: {},
        },
        {
          id: "seyeon-02",
          look: "02",
          role: "editorial",
          image: "./assets/images/looks/seyeon-02.webp",
          fallback: "./assets/images/editorial/editorial-09.webp",
          brands: {},
        },
        {
          id: "cementbay-exhibition",
          look: "03",
          role: "exhibition",
          image: "./assets/images/looks/cementbay-exhibition.webp",
          fallback: "./assets/images/editorial/editorial-08.webp",
          brands: {},
        },
      ],
    },
  ];

  const screenOrder = ["intro", ...shops.map((shop) => shop.id)];
  const exhibition = document.querySelector("#exhibition");
  const editorialRail = document.querySelector("#editorialRail");
  const editorialList = document.querySelector("#editorialList");
  const editorialCounter = document.querySelector("#editorialCounter");

  let activeEditorialIndex = 0;
  let selectedLookId = "";
  let editorialFrame = 0;
  let horizontalFrame = 0;

  function editorialPath(index) {
    return `./assets/images/editorial/editorial-${String(index + 1).padStart(2, "0")}.webp`;
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
    card.append(imageWrap);
    card.addEventListener("click", () => selectLook(look.id));
    return card;
  }

  function makeLookCards() {
    shops.forEach((shop) => {
      const screen = document.querySelector(`[data-shop="${shop.id}"]`);
      const grid = screen?.querySelector("[data-look-grid]");
      if (!grid) return;
      grid.replaceChildren(...shop.looks.map((look) => makeLookCard(shop, look)));
    });
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

    screen.classList.add("has-selection");
    screen.classList.toggle("has-exhibition-selection", look.role === "exhibition");
    lookInfo.setAttribute("aria-hidden", "false");
    lookName.textContent = `${shop.model} — look ${look.look}`;
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

  makeEditorialSlides();
  makeLookCards();
})();
