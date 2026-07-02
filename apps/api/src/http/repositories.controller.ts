import { Controller, Get, Param } from '@nestjs/common';
import { VerificationRepository } from '../storage/verification.repository';

@Controller()
export class RepositoriesController {
  constructor(private readonly repository: VerificationRepository) {}

  @Get('repos')
  listRepositories() {
    return this.repository.listRepositories();
  }

  @Get('repos/:id/prs')
  listPullRequests(@Param('id') id: string) {
    return this.repository.listPullRequests(id);
  }
}
