
StiMvcViewer.prototype.InitializeMenu = function (menu) {
    menu.jsObject = this;
    menu.animationTimer = null;
    menu.hideTimer = null;
    menu.showTimer = null;
    menu.visible = false;
    menu.shadowLevel = 6;
    menu.menuName = menu.getAttribute("menuName");

    menu.parentElement.style.display = "";
    menu.width = menu.offsetWidth + menu.shadowLevel;
    menu.height = menu.offsetHeight + menu.shadowLevel;
    if (menu.isSubMenu) menu.style.left = (menu.jsObject.options.rightToLeft ? menu.width : -menu.width) + "px"; else menu.style.top = -menu.height + "px"; //goto Start Pos
    menu.parentElement.style.display = "none";

    //Mouse Events
    menu.onmouseover = function () {
        if (this.isSubMenu) {
            if (this.jsObject.options.menuShowMode == "Hover") clearTimeout(this.parentMenu.hideTimer);
            this.parentButton.setSelected(true);
        }

        clearTimeout(this.hideTimer);
        clearTimeout(this.showTimer);
    }

    menu.onmouseout = function () {
        if (this.jsObject.options.menuShowMode == "Hover") {
            this.hideWithDelay(this.isSubMenu
                ? this.jsObject.options.menuHideDelay
                : (this.jsObject.options.currentSubMenu ? this.jsObject.options.menuHideDelay * 2 : this.jsObject.options.menuHideDelay));
            if (this.isSubMenu) this.parentMenu.hideWithDelay(this.jsObject.options.menuHideDelay * 2);
        }
    }

    //Show
    menu.show = function () {
        this.parentElement.style.display = "";
        this.parentElement.style.zIndex = this.isSubMenu ? 6 : 4;
        this.parentElement.style.width = this.width + "px";
        this.parentElement.style.height = this.height + "px";
        this.jsObject.options.forms["ExportForm"].hide();

        if (this.isSubMenu) {
            if (this.jsObject.options.currentSubMenu != null && this.jsObject.options.currentSubMenu != this) this.jsObject.options.currentSubMenu.hide();
            this.jsObject.options.currentSubMenu = this;
            this.parentElement.style.left = (this.jsObject.options.rightToLeft)
                ? (this.jsObject.FindPosX(this.parentButton, "stiMainPanel") - this.offsetWidth + 2) + "px"
                : (this.jsObject.FindPosX(this.parentButton, "stiMainPanel") + this.parentButton.offsetWidth - 2) + "px";
            this.parentElement.style.top = (this.jsObject.FindPosY(this.parentButton, "stiMainPanel") + 1) + "px";
        }
        else {
            if (this.jsObject.options.currentMenu != null && this.jsObject.options.currentMenu != this) this.jsObject.options.currentMenu.hide();
            this.jsObject.options.currentMenu = this;
            this.parentElement.style.left = (this.jsObject.options.rightToLeft)
                ? (this.jsObject.FindPosX(this.parentButton, "stiToolBar") - (this.offsetWidth - this.parentButton.offsetWidth)) + "px"
                : (this.jsObject.FindPosX(this.parentButton, "stiToolBar") + 1) + "px";
            this.parentElement.style.top = (this.jsObject.FindPosY(this.parentButton, "stiToolBar") + this.parentButton.offsetHeight + 1) + "px";
        }

        d = new Date();
        endTime = this.jsObject.options.menuAnimation ? d.getTime() + this.jsObject.options.menuDuration : d.getTime();
        this.jsObject.ShowAnimationForMenu(this, 0, endTime);
    }

    menu.showWithDelay = function () {
        this.showTimer = setTimeout("js" + this.jsObject.options.mvcViewer.id + ".ShowMenu(" + this.id + ")", this.jsObject.options.subMenuDelay);
    }

    //Hide
    menu.hide = function () {
        this.parentElement.style.zIndex = this.isSubMenu ? 5 : 3;
        d = new Date();
        endTime = this.jsObject.options.menuAnimation ? d.getTime() + this.jsObject.options.menuDuration : d.getTime();
        finishPos = this.isSubMenu ? (this.jsObject.options.rightToLeft ? this.width : -this.width) : -this.height;
        this.jsObject.ShowAnimationForMenu(this, finishPos, endTime);
    }

    menu.hideWithDelay = function (delay) {
        this.hideTimer = setTimeout("js" + this.jsObject.options.mvcViewer.id + ".HideMenu(" + this.id + ")", delay);
    }
}