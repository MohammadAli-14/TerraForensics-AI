function waitForElm(selector) {
  return new Promise(resolve => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver(mutations => {
      if (document.querySelector(selector)) {
        resolve(document.querySelector(selector));
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

// Force change the Swagger logo in the header
waitForElm('.topbar-wrapper').then((elm) => {
  elm.innerHTML = `<a href='${window.location.origin}'><img src='${window.location.origin}/anything-llm-light.png' alt='TerraForensics AI' width='200'/></a>`;
});