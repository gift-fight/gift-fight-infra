import * as gcp from '@pulumi/gcp'
import * as pulumi from '@pulumi/pulumi'

export type GcloudCleanupStackConfig = {
  projectId: pulumi.Input<string>
  registryRegion: pulumi.Input<string>
  registryRepository: pulumi.Input<string>
  schedulerRegion: pulumi.Input<string>
  cleanupAccountName: pulumi.Input<string>
}

export class GcloudCleanupStack extends pulumi.ComponentResource {
  constructor(
    name: string,
    config: GcloudCleanupStackConfig,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('gift-fight:infrastructure:GcloudCleanupStack', name, {}, opts)

    const cleanupAccount = new gcp.serviceaccount.Account(
      'cleanup-account',
      {
        accountId: config.cleanupAccountName,
        displayName: 'Service Account for cleanup',
      },
      { parent: this },
    )

    const cleanupAdminRole = new gcp.projects.IAMCustomRole(
      'cleanup-admin-role',
      {
        roleId: 'cleanupAdmin',
        title: 'Cleanup Admin',
        description: 'A custom role for cleanup',
        permissions: [
          'artifactregistry.repositories.get',
          'artifactregistry.repositories.list',
          'artifactregistry.dockerimages.list',
          'artifactregistry.packages.delete',
          'artifactregistry.packages.get',
          'artifactregistry.packages.list',
          'artifactregistry.tags.get',
          'artifactregistry.tags.list',
          'artifactregistry.tags.delete',
          'artifactregistry.versions.delete',
          'artifactregistry.versions.list',
          'artifactregistry.versions.get',
        ],
      },
      { parent: this },
    )

    new gcp.artifactregistry.RepositoryIamMember(
      'cleanup-admin-role-binding',
      {
        location: config.registryRegion,
        repository: config.registryRepository,
        role: cleanupAdminRole.id,
        member: pulumi.interpolate`serviceAccount:${cleanupAccount.email}`,
      },
      { parent: this },
    )

    const cloudSchedulerAPI = new gcp.projects.Service(
      'cloud-scheduler-api',
      {
        service: 'cloudscheduler.googleapis.com',
        project: config.projectId,
        disableOnDestroy: false,
      },
      { parent: this },
    )

    const cloudRunAPI = new gcp.projects.Service(
      'cloud-run-api',
      {
        service: 'run.googleapis.com',
        project: config.projectId,
        disableOnDestroy: false,
      },
      { parent: this },
    )

    const cleanupRules = [
      { type: 'latest' },
      { type: 'prefixTimestamp', prefix: 'dev-', keep: 2 },
      { type: 'semver', keep: 2, includePrerelease: false },
    ]

    const cleanupJob = new gcp.cloudrunv2.Job(
      'registry-cleanup-job',
      {
        location: config.registryRegion,
        template: {
          template: {
            containers: [
              {
                image: 'risenx/gcr-cleaner',
                envs: [
                  {
                    name: 'GCLOUD_PROJECT_ID',
                    value: config.projectId,
                  },
                  {
                    name: 'GCLOUD_REGISTRY_REGION',
                    value: config.registryRegion,
                  },
                  {
                    name: 'GCLOUD_REGISTRY_REPOSITORY',
                    value: config.registryRepository,
                  },
                  {
                    name: 'CLEANUP_RULES_JSON',
                    value: JSON.stringify(cleanupRules),
                  },
                ],
              },
            ],
            serviceAccount: cleanupAccount.email,
            maxRetries: 3,
            timeout: '900s', // 15 minutes max execution time
          },
        },
        launchStage: 'BETA',
        deletionProtection: false,
      },
      { parent: this, dependsOn: [cloudRunAPI] },
    )

    const invokerIamMember = new gcp.cloudrunv2.JobIamMember(
      'registry-cleanup-job-invoker',
      {
        name: cleanupJob.name,
        location: config.registryRegion,
        role: 'roles/run.invoker',
        member: pulumi.interpolate`serviceAccount:${cleanupAccount.email}`,
      },
      { parent: this, dependsOn: cleanupJob },
    )

    new gcp.cloudscheduler.Job(
      'registry-cleanup-scheduler',
      {
        region: config.schedulerRegion,
        schedule: '0 */6 * * *', // Run every 6 hours
        timeZone: 'UTC',
        httpTarget: {
          uri: pulumi.interpolate`https://${config.registryRegion}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${config.projectId}/jobs/${cleanupJob.name}:run`,
          httpMethod: 'POST',
          oauthToken: {
            serviceAccountEmail: cleanupAccount.email,
          },
        },
      },
      {
        parent: this,
        dependsOn: [cleanupJob, cloudSchedulerAPI, invokerIamMember],
      },
    )

    this.registerOutputs()
  }
}
