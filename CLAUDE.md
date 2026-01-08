# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Pulumi infrastructure-as-code repository for Gift Fight, managing Kubernetes clusters, cloud resources, and deployments across DigitalOcean, Google Cloud, and Cloudflare.

## Essential Commands

### Development & Deployment
- `pnpm pulumi preview` - Preview infrastructure changes
- `pnpm deploy` - Deploy infrastructure changes
- `pnpm destroy` - Destroy infrastructure
- `pnpm refresh` - Refresh state from cloud providers

### Code Quality
- `pnpm lint` - Run Biome linter
- `pnpm lint:fix` - Auto-fix linting issues

### Kubernetes Configuration
- `pnpm kubeconfig:output` - Display kubeconfig
- `pnpm kubeconfig:replace` - Replace local kubeconfig
- `pnpm talosconfig:output` - Display Talos config

## Architecture & Key Components

### Stack Organization
The infrastructure is organized into modular stacks in `src/stacks/`:
- **DoTalosClusterStack** - DigitalOcean Kubernetes cluster using Talos Linux
- **CloudflareStack** - DNS, load balancing, and CDN configuration
- **GcloudStack** - Google Cloud container registry and backup storage
- **CommonSecretsStack** - Cross-platform secret management
- **FluxBootstrap** - GitOps deployment automation via Flux CD

### Configuration Management
- **Environment Variables**: Required secrets are defined in `.env` (see `src/config.ts` for schema)
- **Pulumi Runtime**: Uses Node.js with TypeScript (tsx loader)
- **Type Safety**: Strict TypeScript configuration with comprehensive type checking

### Key Dependencies
- Infrastructure providers: DigitalOcean, Google Cloud, Cloudflare, GitHub
- Kubernetes management: Talos, Flux CD
- Secret management: Infisical integration

## Development Workflow

1. Environment variables must be configured before running any Pulumi commands
2. The main entry point (`src/index.ts`) orchestrates all stack deployments
3. Stack dependencies are explicitly managed through Pulumi's dependency system
4. Code formatting follows Biome standards (2-space indentation, single quotes)

## Important Patterns

- Component resources extend `pulumi.ComponentResource` for modularity
- Stack configurations use typed interfaces for compile-time safety
- Cross-stack dependencies are managed through constructor options
- Secrets are never hardcoded - always sourced from environment or Infisical