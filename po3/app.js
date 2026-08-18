(() => {
  const EDITORIAL_COUNT = 13;

  const looks = [
    {
      id: "yumin-01",
      model: "유민",
      look: "01",
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
      model: "유민",
      look: "02",
      image: "./assets/images/looks/yumin-02.webp",
      fallback: "./assets/images/editorial/editorial-03.webp",
      brands: {},
    },
    {
      id: "gayoung-01",
      model: "가영",
      look: "01",
      image: "./assets/images/looks/gayoung-01.webp",
      fallback: "./assets/images/editorial/editorial-05.webp",
      brands: {},
    },
    {
      id: "gayoung-02",
      model: "가영",
      look: "02",
      image: "./assets/images/looks/gayoung-02.webp",
      fallback: "./assets/images/editorial/editorial-06.webp",
      brands: {},
    },
    {
      id: "seyeon-01",
      model: "세연",
      look: "01",
      image: "./assets/images/looks/seyeon-01.webp",
      fallback: "./assets/images/editorial/editorial-07.webp",
      brands: {},
    },
    {
      id: "seyeon-02",
      model: "세연",
      look: "02",
      image: "./assets/images/looks/seyeon-02.webp",
      fallback: "./assets/images/editorial/editorial-09.webp",
      brands: {},
    },
  ];

  const exhibition = document.querySelector("#exhibition");
  const editorialRail = document.querySelector("#editorialRail");
  const editorialList = document.querySelector("#editorialList");
  const editorialCounter = document.querySelector("#editorialCounter");
  const looksScreen = document.querySelector("#looks");
  const lookGrid = document.querySelector("#lookGrid");
  const lookInfo = document.querySelector("#lookInfo");
  const lookName = document.querySelector("#lookName");
  const lookNumber = document.querySelector("#lookNumber");
  const brandList = document.querySelector("#brandList");
  const lookClose = document.querySelector("#lookClose");

  let activeEditorialIndex = 0;
  let selectedLookId = "";
  let editorialFrame = 0;

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
        if (!image.getAttribute("src")) {
          image.src = image.dataset.src;
        }
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

  function makeLookCards() {
    const fragment = document.createDocumentFragment();

    looks.forEach((look, index) => {
      const card = document.createElement("button");
      card.className = "look-card";
      card.type = "button";
      card.dataset.lookId = look.id;
      card.setAttribute("aria-pressed", "false");
      card.setAttribute("aria-label", `${look.model} 착장 ${look.look}`);

      const imageWrap = document.createElement("span");
      imageWrap.className = "look-image";

      const image = document.createElement("img");
      image.src = look.image;
      image.alt = `${look.model} 착장 ${look.look}`;
      image.decoding = "async";
      image.draggable = false;
      image.addEventListener(
        "error",
        () => {
          if (image.src.endsWith(look.fallback.replace(/^\.\//, "/"))) return;
          image.src = look.fallback;
        },
        { once: true },
      );

      const label = document.createElement("span");
      label.className = "look-label";
      label.innerHTML = `<span>${look.model}</span><span>${String(index + 1).padStart(2, "0")}</span>`;

      imageWrap.append(image);
      card.append(imageWrap, label);
      card.addEventListener("click", () => selectLook(look.id));
      fragment.append(card);
    });

    lookGrid.replaceChildren(fragment);
  }

  function renderBrands(brands = {}) {
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

  function selectLook(id) {
    const lookIndex = looks.findIndex((look) => look.id === id);
    const look = looks[lookIndex];
    if (!look) return;

    selectedLookId = id;
    looksScreen.classList.add("has-selection");
    lookInfo.setAttribute("aria-hidden", "false");
    lookName.textContent = `${look.model} — look ${look.look}`;
    lookNumber.textContent = `${String(lookIndex + 1).padStart(2, "0")} / ${String(looks.length).padStart(2, "0")}`;
    renderBrands(look.brands);

    lookGrid.querySelectorAll(".look-card").forEach((card) => {
      const isSelected = card.dataset.lookId === id;
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function clearLook() {
    selectedLookId = "";
    looksScreen.classList.remove("has-selection");
    lookInfo.setAttribute("aria-hidden", "true");
    lookGrid.querySelectorAll(".look-card").forEach((card) => {
      card.classList.remove("is-selected");
      card.setAttribute("aria-pressed", "false");
    });
  }

  function goToScreen(screenId) {
    const target = document.querySelector(`#${screenId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function selectAdjacentLook(direction) {
    if (!selectedLookId) return;
    const currentIndex = looks.findIndex((look) => look.id === selectedLookId);
    const nextIndex = Math.max(0, Math.min(looks.length - 1, currentIndex + direction));
    selectLook(looks[nextIndex].id);
  }

  editorialRail.addEventListener("scroll", () => {
    cancelAnimationFrame(editorialFrame);
    editorialFrame = requestAnimationFrame(updateEditorialIndex);
  });

  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => goToScreen(button.dataset.screen));
  });

  lookClose.addEventListener("click", clearLook);

  document.addEventListener("keydown", (event) => {
    const onLooks = exhibition.scrollLeft >= window.innerWidth * 0.5;

    if (event.key === "Escape" && selectedLookId) {
      clearLook();
      return;
    }

    if (onLooks && selectedLookId && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      selectAdjacentLook(event.key === "ArrowRight" ? 1 : -1);
      return;
    }

    if (event.key === "ArrowRight") goToScreen("looks");
    if (event.key === "ArrowLeft") goToScreen("intro");

    if (!onLooks && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
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
