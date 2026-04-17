
StiMvcViewer.prototype.InitializeMenuItem = function (menuItem) {
    menuItem.jsObject = this;
    menuItem.itemName = menuItem.getAttribute("itemName");
    menuItem.thisMenu = document.getElementById(this.options.mvcViewer.id + menuItem.getAttribute("menuName"));
    menuItem.image = document.getElementById(menuItem.id + "Image");
    menuItem.menu = document.getElementById(this.options.mvcViewer.id + menuItem.itemName + "Menu");
    if (menuItem.menu) {
        menuItem.menu.parentButton = menuItem;
        menuItem.menu.parentMenu = menuItem.thisMenu;
    }
    if (!menuItem.thisMenu.itemsArray) menuItem.thisMenu.itemsArray = [];
    menuItem.thisMenu.itemsArray.push(menuItem);

    menuItem.showTimer = null;
    menuItem.isSelected = false;
    menuItem.isOver = false;

    menuItem.setSelected = function (state) {
        this.isSelected = state;
        this.className = this.isOver ? "stiMenuItemOver" : (state ? "stiMenuItemOver" : "stiMenuItem");
    }

    menuItem.onclick = function () {
        if (this.menu) { if (this.menu.visible) this.menu.hide(); else this.menu.show(); return; }
        else {
            this.jsObject.hideAllMenus();

            switch (this.thisMenu.menuName) {
                case "PrintMenu": this.jsObject.postPrint(this.itemName); break;
                case "SaveMenu": this.jsObject.clickExport(this.itemName.replace("Save", "")); break;
                case "SendEmailMenu": this.jsObject.clickSendEmail(this.itemName.replace("SendEmail", "")); break;
                case "ZoomMenu":
                case "ViewModeMenu": this.jsObject.postAction(this.itemName); break;
            }
        }
    }

    menuItem.onmouseover = function () {
        if (this.isOver) return;
        this.className = "stiMenuItemOver";
        if (this.getAttribute("textColor")) this.style.color = "White";
        this.isOver = true;

        if (this.thisMenu.animationTimer == null) {
            if (this.menu) {
                clearTimeout(this.menu.hideTimer);
                clearTimeout(this.menu.showTimer);
                this.menu.showWithDelay();
            }
            else {
                if (!this.thisMenu.isSubMenu && this.jsObject.options.currentSubMenu != null)
                    if (this.jsObject.options.currentSubMenu.animationTimer == null) this.jsObject.options.currentSubMenu.hide();
            }
        }
    }

    menuItem.onmouseout = function (event) {
        this.className = this.isSelected ? "stiMenuItemOver" : "stiMenuItem";
        if (this.getAttribute("textColor")) this.style.color = this.getAttribute("textColor");
        this.isOver = false;
        if (this.menu && this.thisMenu.animationTimer == null) {
            clearTimeout(this.menu.hideTimer);
            clearTimeout(this.menu.showTimer);
            this.menu.hideWithDelay(this.jsObject.options.menuHideDelay);
        }
    }
}

