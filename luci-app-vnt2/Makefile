include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI for VNT2
LUCI_DEPENDS:=+luci-base +luci-compat +kmod-tun
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-vnt2
PKG_VERSION:=1.6.4
PKG_RELEASE:=1
PKG_PO_VERSION:=$(PKG_VERSION)

LUCI_MINIFY_JS:=0
LUCI_MINIFY_CSS:=0

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/conffiles
/etc/config/vnt2
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
INITD=/etc/init.d
if [ "$$(uci -q get vnt2.global.arch)" = "0" ]; then
    uci set vnt2.global.arch="$$(uname -m)"
    uci commit vnt2
fi
$${INITD}/vnt2 enable
$${INITD}/vnt2 restart
rm -rf /tmp/luci-*

exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
INITD=/etc/init.d
$${INITD}/vnt2 stop    2>/dev/null || true
$${INITD}/vnt2 disable 2>/dev/null || true
ubus call service set '{"name":"vnt2","instances":{}}' 2>/dev/null || true
rm -rf /tmp/luci-*

exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
