
StiMvcViewer.prototype.InitializeBookmarksPanel = function (bookmarksPanel) {
    bookmarksPanel.jsObject = this;
    this.options.bookmarks = bookmarksPanel;
    bookmarksPanel.container = document.getElementById(bookmarksPanel.id + "Container");

    bookmarksPanel.changeVisibleState = function (state) {
        this.style.display = state ? "" : "none";
        this.style.width = this.jsObject.options.bookmarksTreeWidth + "px";        
        if (this.jsObject.options.buttons["Bookmarks"]) this.jsObject.options.buttons["Bookmarks"].setSelected(state);
        this.jsObject.options.reportPanel.style.marginLeft = state ? (this.jsObject.options.bookmarksTreeWidth + 5) + "px" : "0px";
    }

    bookmarksPanel.addContent = function (content) {
        this.container.innerHTML = content;
    }

    bookmarksPanel.onclick = function () {
        this.jsObject.hideAllMenus();
    }
}