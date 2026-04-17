
StiMvcViewer.prototype.InitializeToolBar = function (toolbar) {
    toolbar.jsObject = this;
    this.options.toolbar = toolbar;
    this.options.buttons["PageControlText"] = document.getElementById(this.options.mvcViewer.id + "PageControlText");
    this.options.buttons["PageControlCountLabel"] = document.getElementById(this.options.mvcViewer.id + "PageControlCountLabel");
    if (this.options.buttons["PageControlText"] != null) {
        this.options.buttons["PageControlText"].jsObject = this;
        this.options.buttons["PageControlCountLabel"].jsObject = this;
    }

    zoomMenu = document.getElementById(this.options.mvcViewer.id + "ZoomMenu");
    if (zoomMenu) toolbar.zoomItems = zoomMenu.itemsArray;

    toolbar.changeToolBarState = function () {
        options = this.jsObject.options;
        buttons = options.buttons;

        if (buttons["FirstPage"]) buttons["FirstPage"].setEnabled(options.pageNumber > 0 && options.menuViewMode == "OnePage");
        if (buttons["PrevPage"]) buttons["PrevPage"].setEnabled(options.pageNumber > 0 && options.menuViewMode == "OnePage");
        if (buttons["NextPage"]) buttons["NextPage"].setEnabled(options.pageNumber < options.pagesCount - 1 && options.menuViewMode == "OnePage");
        if (buttons["LastPage"]) buttons["LastPage"].setEnabled(options.pageNumber < options.pagesCount - 1 && options.menuViewMode == "OnePage");
        if (buttons["ViewMode"])
            if (buttons["ViewMode"].caption)
                buttons["ViewMode"].caption.innerHTML = buttons["ViewMode"].getAttribute(options.menuViewMode) + "&nbsp;";
        if (buttons["Zoom"])
            if (buttons["Zoom"].caption) buttons["Zoom"].caption.innerHTML = options.zoom + "%&nbsp;";
        if (buttons["PageControlCountLabel"]) buttons["PageControlCountLabel"].innerHTML = options.pagesCount;
        if (buttons["PageControlText"]) {
            buttons["PageControlText"].value = options.pageNumber + 1;
            buttons["PageControlText"].disabled = (options.pagesCount <= 1 || options.menuViewMode == "WholeReport");
        }
        for (var index in toolbar.zoomItems)
            if (toolbar.zoomItems[index].itemName != "ZoomOnePage" && toolbar.zoomItems[index].itemName != "ZoomPageWidth")
                toolbar.zoomItems[index].image.style.display = (toolbar.zoomItems[index].itemName == "Zoom" + options.zoom) ? "" : "none";
        if (buttons["Bookmarks"]) buttons["Bookmarks"].setEnabled(options.haveBookmarks);
    }

    toolbar.onclick = function () {
        this.jsObject.hideAllParameterMenus();
    }

    if (this.options.buttons["PageControlText"]) {
        this.options.buttons["PageControlText"].onkeypress = function (event) {
            var keyCode = window.event ? window.event.keyCode : event.keyCode;
            if (keyCode == 13) {
                this.jsObject.postAction("GoToPage");
                return false;
            }
        }

        this.options.buttons["PageControlText"].getCorrectValue = function () {
            value = parseInt(this.value);
            if (value < 1 || !value) value = 1;
            if (value > this.jsObject.options.pagesCount) value = this.jsObject.options.pagesCount;
            return value;
        }
    }
}