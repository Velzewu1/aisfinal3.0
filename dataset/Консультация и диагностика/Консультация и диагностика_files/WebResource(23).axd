
StiMvcViewer.prototype.InitializeToolTip = function () {
    var toolTip = document.createElement("div");
    toolTip.id = this.options.mvcViewer.id + "ToolTip";
    toolTip.jsObject = this;
    this.options.toolTip = toolTip;
    this.options.mainPanel.appendChild(toolTip);    
    toolTip.className = "stiToolTip";
    toolTip.style.display = "none";
    toolTip.showTimer = null;
    toolTip.hideTimer = null;
    toolTip.visible = false;

    toolTip.innerTable = this.CreateHTMLTable();
    toolTip.innerTable.className = "stiOverrideGloobalMvcStyles";
    toolTip.appendChild(toolTip.innerTable);

    toolTip.textCell = toolTip.innerTable.addCell();
    toolTip.textCell.className = "stiToolTipTextCell";

    toolTip.helpButton = this.CreateHTMLTable();
    toolTip.helpButton.jsObject = this;
    toolTip.helpButton.className = "stiToolTipButton";
    toolTip.innerTable.addCellInNextRow(toolTip.helpButton).className = "stiOverrideGloobalMvcStyles";
    toolTip.helpButton.style.margin = "4px 8px 4px 8px";

    toolTip.helpButton.image = document.createElement("div");
    toolTip.helpButton.image.className = "stiToolTipImage";
    toolTip.helpButton.addCell(toolTip.helpButton.image).className = "stiOverrideGloobalMvcStyles";

    var captionButton = toolTip.helpButton.addCell();
    captionButton.innerHTML = this.options.wordTellMeMore;
    captionButton.style.padding = "0 0 0 7px";
    captionButton.style.border = "0px";
    captionButton.style.whiteSpace = "nowrap";

    toolTip.helpButton.onmouseover = function () {
        this.className = "stiToolTipButtonOver";
    }

    toolTip.helpButton.onmouseout = function () {
        this.className = "stiToolTipButton";
    }

    toolTip.helpButton.action = function () { }
    toolTip.helpButton.onclick = function () { this.action(); }

    toolTip.show = function (text, helpUrl, leftPos, topPos) {
        if (this.visible && text == this.textCell.innerHTML) return;
        this.hide();
        this.textCell.innerHTML = text;
        this.helpButton.helpUrl = helpUrl;
        this.helpButton.action = function () { this.jsObject.ShowHelpWindow(this.helpUrl); }
        this.style.left = leftPos + "px";
        this.style.top = topPos + "px";
        var d = new Date();
        var endTime = d.getTime() + 300;
        this.style.opacity = 1 / 100;
        this.style.display = "";
        this.visible = true;
        this.jsObject.ShowAnimationForm(this.id, endTime);
    }

    toolTip.showWithDelay = function (text, helpUrl, leftPos, topPos) {
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
        this.showTimer = setTimeout("js" + this.jsObject.options.mvcViewer.id + ".options.toolTip.show('" + text + "', '" + helpUrl + "', " + leftPos + ", " + topPos + ")", 300);
    }

    toolTip.hide = function () {
        this.visible = false;
        clearTimeout(this.showTimer);
        this.style.display = "none";
    }

    toolTip.hideWithDelay = function () {
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout("js" + this.jsObject.options.mvcViewer.id + ".options.toolTip.hide()", 500);
    }

    toolTip.onmouseover = function () {
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
    }

    toolTip.onmouseout = function () {
        this.hideWithDelay();
    }
}