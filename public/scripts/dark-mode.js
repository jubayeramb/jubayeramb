const run = () => {
  const theme = (() => {
    const localTheme = localStorage.getItem("theme");
    if (localTheme) {
      return localTheme;
    } else {
      return null;
    }
  })();

  if (!!theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }
};

document.addEventListener("astro:after-swap", run);

run();
