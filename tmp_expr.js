`
    (async () => {
      if (!window.__apiFetchPatched) {
        const originalFetch = window.fetch.bind(window)