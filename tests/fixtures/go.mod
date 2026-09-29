module github.com/acme/payments

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/text v0.14.0 // indirect
	corp.internal/platform/auth v1.2.0
)

require github.com/stretchr/testify v1.8.4

replace github.com/gin-gonic/gin => ../gin-fork
replace github.com/stretchr/testify v1.8.4 => github.com/fork/testify v1.8.5
exclude golang.org/x/sys v0.1.0
