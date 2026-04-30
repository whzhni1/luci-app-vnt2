include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI for VNT2
LUCI_DEPENDS:=+luci-base +luci-compat +kmod-tun
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-vnt2
PKG_VERSION:=1.3.0
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
$${INITD}/vnt2 enable
(sleep 3
 $${INITD}/rpcd restart
 [ -x $${INITD}/uhttpd ] && $${INITD}/uhttpd restart
 [ -x $${INITD}/nginx  ] && $${INITD}/nginx   restart
 $${INITD}/vnt2 start
 [ -x /usr/libexec/vnt2-update.sh ] && /usr/libexec/vnt2-update.sh
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
for f in vnt2_cli vnt2_web vnt2_ctrl vnt2s; do
	rm -f $${BINDIR}/$$f
done
for f in $${CFGDIR}/*.vnt $${CFGDIR}/*.vnts; do
	rm -f $$f
done
(sleep 2
 $${INITD}/rpcd restart
 [ -x $${INITD}/uhttpd ] && $${INITD}/uhttpd restart
 [ -x $${INITD}/nginx  ] && $${INITD}/nginx   restart
) > /dev/null 2>&1 &

exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
