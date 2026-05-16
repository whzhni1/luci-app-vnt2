include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI for VNT2
LUCI_DEPENDS:=+luci-base +luci-compat +kmod-tun
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-vnt2
PKG_VERSION:=1.5.2
PKG_RELEASE:=1

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
(sleep 3
 $${INITD}/rpcd restart
 [ -x $${INITD}/uhttpd ] && $${INITD}/uhttpd restart
 [ -x $${INITD}/nginx  ] && $${INITD}/nginx   restart
 $${INITD}/vnt2 start
) > /dev/null 2>&1 &

exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
INITD=/etc/init.d
BINDIR=/usr/bin
CFGDIR=/etc/vnt2_config
$${INITD}/vnt2 stop    2>/dev/null || true
$${INITD}/vnt2 disable 2>/dev/null || true
ubus call service set '{"name":"vnt2","instances":{}}' 2>/dev/null || true
(sleep 2
 $${INITD}/rpcd restart
 [ -x $${INITD}/uhttpd ] && $${INITD}/uhttpd restart
 [ -x $${INITD}/nginx  ] && $${INITD}/nginx   restart
) > /dev/null 2>&1 &

exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
