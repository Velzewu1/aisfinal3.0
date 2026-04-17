
StiMvcViewer.prototype.InitializeToolButton = function (button) {
    button.jsObject = this;
    button.buttonName = button.getAttribute("buttonName");
    button.caption = document.getElementById(this.options.mvcViewer.id + "Button" + button.buttonName + "Caption");
    button.image = document.getElementById(this.options.mvcViewer.id + "Button" + button.buttonName + "Image");
    button.menu = document.getElementById(this.options.mvcViewer.id + button.buttonName + "Menu");
    button.toolTip = button.getAttribute("toolTipObject") ? button.getAttribute("toolTipObject").split(";") : null;
    if (button.menu) button.menu.parentButton = button;
    this.options.buttons[button.buttonName] = button;

    button.isDisable = false;
    button.isSelected = false;
    button.isOver = false;
    button.isFormButton = (button.getAttribute("formButton") == "True" || button.getAttribute("formButton") == "true");

    button.setSelected = function (state) {
        this.isSelected = state;
        this.className = this.isOver ? "stiHover" : (state ? "stiSelected" : null);
    }

    button.setEnabled = function (state) {
        this.isDisable = !state;
        if (!state) this.className = null;
        this.image.src = (state) ? this.image.getAttribute("source") : this.image.getAttribute("sourceDisabled");
    }

    button.onclick = function () {
        if (this.isDisable) return;
        if (this.toolTip && this.jsObject.options.showTooltips) this.jsObject.options.toolTip.hide();
        if (this.menu) {
            flag = false;            
            if (this.jsObject.options.currentSubMenu) { flag = true; this.jsObject.hideAllMenus(); }
            if (this.menu.visible) { if (!flag) this.menu.hide(); }
            else this.menu.show();
        }
        else {
            this.jsObject.postAction(this.buttonName);
            this.jsObject.hideAllMenus();
        }
    }

    button.onmouseover = function () {
        if (this.isDisable || this.isOver) return;
        this.className = "stiHover";
        this.isOver = true;
        if (this.toolTip && this.jsObject.options.showTooltips && !(this.menu && this.isSelected))
            this.jsObject.options.toolTip.showWithDelay(
                        this.toolTip[0],
                        this.toolTip[1],
                        this.toolTip.length > 2 ? this.toolTip[2] : this.jsObject.FindPosX(this, "stiMainPanel") + 3,
                        this.toolTip.length > 2 ? this.toolTip[3] : this.jsObject.options.toolbar.offsetHeight - 2
                    );

        if (this.menu) {
            clearTimeout(this.menu.hideTimer);
            clearTimeout(this.menu.showTimer);
            if (this.jsObject.options.menuShowMode == "Hover") {
                if (!this.menu.visible) this.jsObject.hideAllMenus();
                this.menu.show();
            }
        }
        else
            if (this.jsObject.options.menuShowMode == "Hover") this.jsObject.hideAllMenus();
    }

    button.onmouseout = function (event) {
        if (this.toolTip && this.jsObject.options.showTooltips) this.jsObject.options.toolTip.hideWithDelay();
        this.className = this.isSelected ? "stiSelected" : (this.isFormButton ? "stiFormButton" : null);
        this.isOver = false;
        if (this.menu) {
            clearTimeout(this.menu.hideTimer);
            clearTimeout(this.menu.showTimer);
            if (this.jsObject.options.menuShowMode == "Hover") this.menu.hideWithDelay(this.jsObject.options.menuHideDelay);
        }
    }
}