// Legacy session dataset tools are retired in the desktop app.
window.OCResearchLab = {
  mount(root) { if (root) { root.replaceChildren(); root.hidden = true; } },
  async syncSelection() {}
};
