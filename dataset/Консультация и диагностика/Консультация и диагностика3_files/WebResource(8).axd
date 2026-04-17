
StiMvcViewer.prototype.InitializeReportPanel = function (reportPanel) {
    reportPanel.jsObject = this;
    this.options.reportPanel = reportPanel;

    reportPanel.addPage = function (pageContent, pageIndex) {
        pageBase = document.createElement("DIV");
        pageBase.style.zIndex = "1";
        pageBase.style.position = "relative";
        pageBase.style.margin = "10px";
        pageBase.style.display = "inline-block";
        pageBase.style.verticalAlign = "top";
        pageBase.style.width = (this.jsObject.options.pageSizes[pageIndex].width + 5) + "px";
        this.appendChild(pageBase);

        page = document.createElement("DIV");
        pageBase.appendChild(page);

        if (this.jsObject.options.pageShowShadow) {
            for (i = 0; i < 5; i++) {
                pageShadow = document.createElement("DIV");
                pageShadow.className = "stiMenuShadow";
                pageBase.appendChild(pageShadow);
                pageShadow.style.right = -i + "px";
                pageShadow.style.bottom = -i + "px";
                pageShadow.style.left = i + "px";
                pageShadow.style.top = i + "px";
            }
        }

        page.style.padding = this.jsObject.options.pageMargins[pageIndex];
        page.style.zIndex = "1";
        page.style.position = "relative";
        if (this.jsObject.options.pageBorderColor) page.style.border = "1px solid " + this.jsObject.options.pageBorderColor;
        page.style.color = "#000000";
        page.style.background = this.jsObject.options.pageBackgrounds[pageIndex];
        page.innerHTML = pageContent;
        this.initializeSorting(page);
    }

    reportPanel.clear = function () {
        while (this.childNodes[0]) {
            this.removeChild(this.childNodes[0]);
        }
    }

    reportPanel.onclick = function () {
        this.jsObject.hideAllMenus();
    }

    reportPanel.getZoomByPageWidth = function () {
        if (this.jsObject.options.pageSizes.length == 0 || this.jsObject.options.pageSizes[0].width == 0) return 100;
        var newZoom = ((this.offsetWidth - (this.jsObject.options.bookmarks ? this.jsObject.options.bookmarks.offsetWidth : 0)) *
            this.jsObject.options.zoom) / (this.jsObject.options.pageSizes[0].width + 20);
        return newZoom;
    }

    reportPanel.getZoomByPageHeight = function () {
        if (this.jsObject.options.pageSizes.length == 0 || this.jsObject.options.pageSizes[0].height == 0) return 100;
        var newPagesHeight = window.innerHeight - (this.jsObject.options.toolbar ? this.jsObject.options.toolbar.offsetHeight : 0) -
            (this.jsObject.options.parametersPanel ? this.jsObject.options.parametersPanel.offsetHeight : 0) - 50;
        var newZoom = (newPagesHeight * this.jsObject.options.zoom) / (this.jsObject.options.pageSizes[0].height + 20);
        return newZoom;
    }

    reportPanel.initializeSorting = function (page) {
        /*var elems = page.getElementsByTagName('TD');
        for (i = 0; i < elems.length; i++)
        if (elems[i].getAttribute("interaction") != null) {
        elems[i].style.cursor = "pointer";
        }*/
    }
}