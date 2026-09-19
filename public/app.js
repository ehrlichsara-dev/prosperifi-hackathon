const $ = (id) => document.getElementById(id);

const form = $("product-form");
const verifyBtn = $("verify-btn");
const adBtn = $("ad-btn");

// Everything downstream of a verification run hangs off this.
let state = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const product = {
    productName: $("productName").value.trim(),
    ingredients: $("ingredients").value.trim(),
    claims: $("claims").value.trim(),
    brandVoice: $("brandVoice").value.trim(),
  };

  resetResults();
  setBusy(verifyBtn, true, "Verifying…");
  setStatus("verify-status", "Reviewing each claim against the ingredient list…");

  try {
    const { claims } = await post("/api/verify", product);
    renderClaims(claims);
    clearStatus("verify-status");

    const unsupported = claims.filter((c) => c.status === "Unsupported");
    if (unsupported.length > 0) {
      show("blocked");
      return;
    }

    state = { product, verifiedClaims: claims };
    show("gold-star");
    show("section-two");
    $("section-two").scrollIntoView({ behavior: "smooth", block: "start" });
    await loadStrategy();
  } catch (error) {
    setStatus("verify-status", error.message, true);
  } finally {
    setBusy(verifyBtn, false, "Verify Claims");
  }
});

adBtn.addEventListener("click", async () => {
  setBusy(adBtn, true, "Writing…");
  setStatus("ad-status", "Writing the ad in your brand voice…");
  hide("ad");

  try {
    const { ad } = await post("/api/ad", {
      productName: state.product.productName,
      brandVoice: state.product.brandVoice,
      verifiedClaims: state.verifiedClaims,
      strategy: state.strategy,
    });
    $("ad").textContent = ad;
    show("ad");
    clearStatus("ad-status");
  } catch (error) {
    setStatus("ad-status", error.message, true);
  } finally {
    setBusy(adBtn, false, "Generate Ad");
  }
});

async function loadStrategy() {
  setStatus("strategy-status", "Finding the right audience for the verified claims…");

  try {
    const strategy = await post("/api/strategy", {
      productName: state.product.productName,
      ingredients: state.product.ingredients,
      verifiedClaims: state.verifiedClaims,
    });
    state.strategy = strategy;

    $("target-audience").textContent = strategy.target_audience;
    $("main-concern").textContent = strategy.main_concern;
    $("why-fits").textContent = strategy.why_it_fits;

    clearStatus("strategy-status");
    show("strategy");
    show("ad-btn");
  } catch (error) {
    setStatus("strategy-status", error.message, true);
  }
}

/* -------------------------------------------------------------- rendering */

function renderClaims(claims) {
  const list = $("claim-list");
  list.replaceChildren(
    ...claims.map((claim) => {
      const item = document.createElement("li");

      const badge = document.createElement("span");
      badge.className = `badge badge-${claim.status.toLowerCase()}`;
      badge.textContent = claim.status;

      const body = document.createElement("div");
      const text = document.createElement("p");
      text.className = "claim-text";
      text.textContent = claim.claim;
      const reason = document.createElement("p");
      reason.className = "claim-reason";
      reason.textContent = claim.reason;
      body.append(text, reason);

      item.append(badge, body);
      return item;
    }),
  );
  show("claim-list");
}

function resetResults() {
  state = null;
  ["claim-list", "gold-star", "blocked", "section-two", "strategy", "ad", "ad-btn"].forEach(hide);
  ["strategy-status", "ad-status"].forEach(clearStatus);
}

/* ---------------------------------------------------------------- helpers */

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function show(id) {
  $(id).hidden = false;
}

function hide(id) {
  $(id).hidden = true;
}

function setStatus(id, message, isError = false) {
  const element = $(id);
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.hidden = false;
}

function clearStatus(id) {
  const element = $(id);
  element.textContent = "";
  element.classList.remove("error");
  element.hidden = true;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}
